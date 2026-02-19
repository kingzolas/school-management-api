// loaders/migrations.js
const { runFixCoraPaidAt } = require('../scripts/fixCoraPaidAt');

async function runCoraPaidAtFixIfEnabled() {
  const enabled =
    String(process.env.RUN_CORA_PAIDAT_FIX || '').toLowerCase() === 'true';

  if (!enabled) {
    console.log('🟡 [Migration] RUN_CORA_PAIDAT_FIX não habilitado. Pulando.');
    return;
  }

  console.log('🧩 [Migration] RUN_CORA_PAIDAT_FIX habilitado. Iniciando correção...');

  await runFixCoraPaidAt({
    batchSize: Number(process.env.CORA_FIX_BATCH_SIZE || 150),
    concurrency: Number(process.env.CORA_FIX_CONCURRENCY || 6),
    maxToProcess: Number(process.env.CORA_FIX_MAX || 0), // 0 = ilimitado
    dryRun: String(process.env.CORA_FIX_DRYRUN || '').toLowerCase() === 'true',
  });
}

module.exports = { runCoraPaidAtFixIfEnabled };
