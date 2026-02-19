// scripts/fixCoraPaidAt.js
const mongoose = require('mongoose');
const Invoice = require('../api/models/invoice.model');
const School = require('../api/models/school.model');
const GatewayFactory = require('../api/gateways/gateway.factory');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

// Heurística: “suspeita” se paidAt nulo OU muito perto do updatedAt (ex.: sync gravou)
function isPaidAtSuspicious(inv) {
  if (!inv.paidAt) return true;
  if (!inv.updatedAt) return false;

  const diffMs = Math.abs(
    new Date(inv.updatedAt).getTime() - new Date(inv.paidAt).getTime()
  );

  // se paidAt colado no updatedAt (<= 10 minutos), costuma ser data de sync
  return diffMs <= 10 * 60 * 1000;
}

// Lock e checkpoint em uma collection própria
const LOCK_COLLECTION = 'migration_runs';
const AUDIT_COLLECTION = 'invoice_paidat_audits';

function currentHost() {
  return process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'unknown';
}

/**
 * ✅ Lock seguro (sem upsert condicional):
 * - tenta adquirir lock via update se doc existe e está livre/expirado
 * - se doc não existe, tenta insertOne (race-safe)
 * - se estiver travado, retorna null (sem E11000)
 */
async function acquireLock(lockKey) {
  const col = mongoose.connection.collection(LOCK_COLLECTION);
  const now = new Date();
  const host = currentHost();

  // trava expira em 2h (pra não ficar preso se crashar)
  const lockTTLms = 2 * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + lockTTLms);

  // 1) tenta pegar lock via UPDATE (doc existente livre/expirado)
  const res = await col.findOneAndUpdate(
    {
      _id: lockKey,
      $or: [
        { locked: { $ne: true } },
        { lockExpiresAt: { $exists: false } },
        { lockExpiresAt: { $lte: now } },
      ],
    },
    {
      $set: {
        locked: true,
        lockExpiresAt: expiresAt,
        lockedAt: now,
        host,
        status: 'running',
        updatedAt: now,
      },
    },
    { upsert: false, returnDocument: 'after' }
  );

  if (res?.value?.locked === true && res.value.host === host) {
    // garante defaults se esse doc foi criado antigamente sem alguns campos
    const doc = res.value;
    if (typeof doc.processed !== 'number') doc.processed = 0;
    if (typeof doc.updated !== 'number') doc.updated = 0;
    if (typeof doc.errors !== 'number') doc.errors = 0;
    if (!('lastId' in doc)) doc.lastId = null;
    return doc;
  }

  // 2) se não pegou por update, pode ser: (a) doc não existe, (b) está travado
  const existing = await col.findOne(
    { _id: lockKey },
    {
      projection: {
        _id: 1,
        locked: 1,
        lockExpiresAt: 1,
        status: 1,
        host: 1,
        lastId: 1,
        processed: 1,
        updated: 1,
        errors: 1,
      },
    }
  );

  // 2a) existe e está travado -> sai
  if (existing) return null;

  // 2b) não existe -> tenta inserir (race-safe)
  try {
    const doc = {
      _id: lockKey,
      locked: true,
      lockExpiresAt: expiresAt,
      lockedAt: now,
      host,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      lastId: null,
      processed: 0,
      updated: 0,
      errors: 0,
    };

    await col.insertOne(doc);
    return doc;
  } catch (e) {
    // outra instância inseriu antes -> comportamento desejado
    if (String(e?.code) === '11000') return null;
    throw e;
  }
}

/**
 * ✅ Release seguro: não libera lock de outra instância
 */
async function releaseLock(lockKey, finalStatus = 'completed') {
  const col = mongoose.connection.collection(LOCK_COLLECTION);
  const host = currentHost();

  await col.updateOne(
    { _id: lockKey, host },
    {
      $set: {
        locked: false,
        status: finalStatus,
        finishedAt: new Date(),
        updatedAt: new Date(),
      },
      $unset: { lockExpiresAt: '' },
    }
  );
}

async function updateCheckpoint(lockKey, patch) {
  const col = mongoose.connection.collection(LOCK_COLLECTION);
  await col.updateOne({ _id: lockKey }, { $set: patch });
}

async function auditChange({
  runKey,
  invoiceId,
  externalId,
  schoolId,
  oldPaidAt,
  newPaidAt,
}) {
  const col = mongoose.connection.collection(AUDIT_COLLECTION);
  await col.insertOne({
    runKey,
    invoiceId,
    externalId,
    schoolId,
    oldPaidAt: oldPaidAt || null,
    newPaidAt,
    createdAt: new Date(),
  });
}

async function loadCoraGatewayForSchool(schoolId, cache) {
  const key = String(schoolId);
  if (cache.has(key)) return cache.get(key);

  const selectString = [
    'coraConfig.isSandbox',
    'coraConfig.sandbox.clientId',
    '+coraConfig.sandbox.certificateContent',
    '+coraConfig.sandbox.privateKeyContent',
    'coraConfig.production.clientId',
    '+coraConfig.production.certificateContent',
    '+coraConfig.production.privateKeyContent',
    'name',
  ].join(' ');

  const school = await School.findById(schoolId).select(selectString).lean();
  if (!school) throw new Error('School not found: ' + String(schoolId));

  const gateway = await GatewayFactory.create(school, 'CORA');
  cache.set(key, gateway);
  return gateway;
}

async function withRetries(fn, { retries = 3, baseDelayMs = 400 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = baseDelayMs * Math.pow(2, i);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function runFixCoraPaidAt({
  batchSize = 150,
  concurrency = 6,
  maxToProcess = 0,
  dryRun = false,
} = {}) {
  const runKey = 'fix_cora_paidAt_v1';

  const lock = await acquireLock(runKey);
  if (!lock) {
    console.log('🟡 [Migration] Outra instância já está rodando essa correção. Saindo.');
    return;
  }

  console.log('🔒 [Migration] Lock adquirido:', {
    runKey,
    dryRun,
    batchSize,
    concurrency,
    lastId: lock.lastId || null,
    host: currentHost(),
  });

  const gatewayCache = new Map();

  let processed = Number(lock.processed || 0);
  let updated = Number(lock.updated || 0);
  let errors = Number(lock.errors || 0);
  let lastId = lock.lastId ? new mongoose.Types.ObjectId(lock.lastId) : null;

  try {
    while (true) {
      if (maxToProcess > 0 && processed >= maxToProcess) break;

      // Só CORA + paid + external_id
      const query = {
        gateway: 'cora',
        status: 'paid',
        external_id: { $exists: true, $ne: null },
      };

      // Paginação por _id (checkpoint)
      if (lastId) query._id = { $gt: lastId };

      // Busca somente campos necessários (rápido)
      const docs = await Invoice.find(query)
        .select('_id school_id external_id paidAt updatedAt createdAt')
        .sort({ _id: 1 })
        .limit(batchSize)
        .lean();

      if (!docs.length) break;

      // processa em paralelo com limite
      let idx = 0;
      const workers = Array.from({ length: concurrency }).map(async () => {
        while (idx < docs.length) {
          const myIndex = idx++;
          const inv = docs[myIndex];

          processed++;

          const invIdStr = String(inv._id);
          lastId = inv._id;

          // Só tenta corrigir se for suspeita
          if (!isPaidAtSuspicious(inv)) continue;

          try {
            const gateway = await loadCoraGatewayForSchool(
              inv.school_id,
              gatewayCache
            );

            const info = await withRetries(
              () => gateway.getInvoicePaymentInfo(String(inv.external_id)),
              { retries: 3, baseDelayMs: 600 }
            );

            // Esperado: info.paidAt com data real
            const paidAt = info?.paidAt ? new Date(info.paidAt) : null;
            if (!isValidDate(paidAt)) continue;

            const oldPaidAt = inv.paidAt ? new Date(inv.paidAt) : null;

            // Idempotência: se já está igual, não faz nada
            if (oldPaidAt && oldPaidAt.getTime() === paidAt.getTime()) continue;

            if (!dryRun) {
              await Invoice.updateOne({ _id: inv._id }, { $set: { paidAt } });

              await auditChange({
                runKey,
                invoiceId: inv._id,
                externalId: inv.external_id,
                schoolId: inv.school_id,
                oldPaidAt,
                newPaidAt: paidAt,
              });
            }

            updated++;
          } catch (e) {
            errors++;
            console.warn('⚠️ [Migration] erro invoice', {
              invoiceId: invIdStr,
              external_id: String(inv.external_id),
              message: e.message,
            });
          }

          if (maxToProcess > 0 && processed >= maxToProcess) break;
        }
      });

      await Promise.all(workers);

      // salva checkpoint a cada batch
      await updateCheckpoint(runKey, {
        lastId: lastId ? String(lastId) : null,
        processed,
        updated,
        errors,
        updatedAt: new Date(),
      });

      console.log('✅ [Migration] batch concluído', {
        processed,
        updated,
        errors,
        lastId: lastId ? String(lastId) : null,
      });
    }

    // ✅ checkpoint final correto (sem reset)
    await updateCheckpoint(runKey, {
      lastId: lastId ? String(lastId) : null,
      processed,
      updated,
      errors,
      updatedAt: new Date(),
    });

    console.log('🏁 [Migration] Correção finalizada', {
      processed,
      updated,
      errors,
      dryRun,
    });

    await releaseLock(runKey, 'completed');
  } catch (e) {
    console.error('❌ [Migration] Falha geral:', e.message);
    await releaseLock(runKey, 'failed');
    throw e;
  }
}

module.exports = { runFixCoraPaidAt };
