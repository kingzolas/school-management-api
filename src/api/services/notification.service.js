// src/api/services/notification.service.js
const NotificationLog = require('../models/notification-log.model');
const Invoice = require('../models/invoice.model');
const School = require('../models/school.model');
const NotificationConfig = require('../models/notification-config.model');
const whatsappService = require('./whatsapp.service');
const cron = require('node-cron');
const mongoose = require('mongoose');

// ✅ NOVO: serviço de compensação/HOLD
const invoiceCompensationService = require('./invoiceCompensation.service');

// --- IMPORTAÇÃO SEGURA DO EVENT EMITTER ---
let appEmitter;
try {
  appEmitter = require('../../config/eventEmitter');
} catch (e) {
  try {
    appEmitter = require('../../loaders/eventEmitter');
  } catch (e2) {
    console.warn("⚠️ appEmitter não encontrado.");
  }
}

// Texto padrão para evitar cobranças indevidas por atraso de liquidação bancária
const AVISO_LIQUIDACAO =
  "\n\n_Obs: Se você já realizou o pagamento, por favor desconsidere esta mensagem. O banco pode levar até 3 dias úteis para processar a baixa em nosso sistema._";

const TEMPLATES_FUTURO = [
  `Olá {nome}! Tudo bem? 😊\nA *{escola}* está enviando a fatura referente a: *{descricao}*.\nEla vence em {vencimento}, mas já estamos adiantando para sua organização.\nValor: R$ {valor}.${AVISO_LIQUIDACAO}`,
  `Oi {nome}! A mensalidade de *{descricao}* da *{escola}* já está disponível para pagamento.\nVencimento: {vencimento}.\nSegue abaixo os dados:${AVISO_LIQUIDACAO}`,
  `{escola} Informa: Fatura disponível.\n📝 Referência: {descricao}\n💲 Total: R$ {valor}\n🗓️ Vencimento: {vencimento}.${AVISO_LIQUIDACAO}`
];

const TEMPLATES_HOJE = [
  `Bom dia {nome}! A *{escola}* lembra que sua mensalidade vence *HOJE* ({vencimento}).\nValor: R$ {valor}.\nSegue o link para pagamento:${AVISO_LIQUIDACAO}`,
  `Olá {nome}, hoje é o dia do vencimento da fatura da *{escola}*.\nReferente a: {descricao}\nTotal: R$ {valor}.\n\nSegue o código/link para pagamento rápido:${AVISO_LIQUIDACAO}`,
  `Oi! A *{escola}* passa para lembrar do pagamento de *{descricao}* que vence hoje. Copie o código ou acesse o link abaixo:${AVISO_LIQUIDACAO}`
];

const TEMPLATES_ATRASO = [
  `Olá {nome}, a *{escola}* notou que a fatura de *{descricao}* (vencida em {vencimento}) ainda consta como pendente.\nPodemos ajudar? Segue o link atualizado:${AVISO_LIQUIDACAO}`,
  `Oi {nome}! A mensalidade de {descricao} na *{escola}* passou do vencimento ({vencimento}).\nValor original: R$ {valor}.\nSegue os dados para regularização:${AVISO_LIQUIDACAO}`,
  `Lembrete *{escola}*: Consta em aberto a fatura de *{descricao}*.\nPara evitar juros, utilize o link abaixo para atualizar seu boleto:${AVISO_LIQUIDACAO}`
];

class NotificationService {
  constructor() {
    this.isProcessing = false;
  }

  // ✅ utilitário para intervalo do dia
  _getDayRange(dateStr) {
    let base = new Date();
    if (dateStr) {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) base = parsed;
    }

    const startOfDay = new Date(base);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(base);
    endOfDay.setHours(23, 59, 59, 999);

    return { startOfDay, endOfDay };
  }

  // ✅ normaliza erros
  _normalizeWhatsappError(error) {
    const httpStatus = error?.response?.status;
    const apiExistsFalse = error?.response?.data?.response?.message?.[0]?.exists === false;

    const raw =
      error?.response?.data
        ? JSON.stringify(error.response.data).slice(0, 2000)
        : (error?.message ? String(error.message).slice(0, 2000) : 'Erro desconhecido');

    if (apiExistsFalse) {
      return {
        code: 'PHONE_NO_WHATSAPP',
        message: 'Número inválido ou sem WhatsApp.',
        httpStatus: httpStatus || 400,
        raw,
      };
    }

    const msg = (error?.message || '').toLowerCase();
    if (msg.includes('whatsapp desconectado')) {
      return {
        code: 'WHATSAPP_DISCONNECTED',
        message: 'WhatsApp desconectado. Conecte novamente em Configurações.',
        httpStatus: httpStatus || 503,
        raw,
      };
    }

    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('network')) {
      return {
        code: 'NETWORK_TIMEOUT',
        message: 'Falha de conexão/timeout ao enviar. Tente novamente mais tarde.',
        httpStatus: httpStatus || 408,
        raw,
      };
    }

    if (httpStatus === 400) {
      return {
        code: 'BAD_REQUEST',
        message: 'Não foi possível enviar. Verifique o número e tente novamente.',
        httpStatus,
        raw,
      };
    }

    if (httpStatus === 404) {
      return {
        code: 'NOT_FOUND',
        message: 'Não foi possível enviar. Contato/número não encontrado.',
        httpStatus,
        raw,
      };
    }

    return {
      code: 'UNKNOWN',
      message: error?.message || 'Falha ao enviar mensagem.',
      httpStatus: httpStatus || null,
      raw,
    };
  }

  // ✅ valida barcode (heurística prática de boleto)
  _isLikelyValidBarcode(barcode) {
    if (!barcode) return false;
    const s = String(barcode).trim();
    const digitsOnly = s.replace(/\D/g, '');
    if (digitsOnly.length >= 44) return true;
    if (digitsOnly.length >= 47) return true;
    return false;
  }

  /**
   * ✅ NOVO: verifica se a invoice está com HOLD ativo (compensação ativa e dentro de hold_until)
   * Se retornar truthy -> NÃO cobrar/enviar
   */
  async _isInvoiceOnHold(invoice) {
    try {
      if (!invoice?._id || !invoice?.school_id) return false;

      const comp = await invoiceCompensationService.getCompensationByInvoice({
        school_id: invoice.school_id,
        invoice_id: invoice._id
      });

      return !!comp;
    } catch (e) {
      // Se der erro aqui, NÃO travamos a fila inteira.
      console.error("⚠️ Erro ao checar HOLD de compensação:", e?.message || e);
      return false;
    }
  }

  async getDailyStats(schoolId, dateStr) {
    const { startOfDay, endOfDay } = this._getDayRange(dateStr);

    let objectIdSchool;
    try {
      objectIdSchool = new mongoose.Types.ObjectId(schoolId);
    } catch (e) {
      console.error("ID da escola inválido para stats:", schoolId);
      return { queued: 0, processing: 0, sent: 0, failed: 0, total_today: 0 };
    }

    const stats = await NotificationLog.aggregate([
      {
        $match: {
          school_id: objectIdSchool,
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        }
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    const result = {
      queued: 0,
      processing: 0,
      sent: 0,
      failed: 0,
      total_today: 0
    };

    stats.forEach(s => {
      if (result[s._id] !== undefined) result[s._id] = s.count;
    });

    result.total_today = result.queued + result.processing + result.sent + result.failed;
    return result;
  }

  async getForecast(schoolId, targetDate) {
    const simData = new Date(targetDate);
    simData.setHours(12, 0, 0, 0);

    const limitPassado = new Date(simData);
    limitPassado.setDate(limitPassado.getDate() - 60);
    limitPassado.setHours(0, 0, 0, 0);

    const futuroLimit = new Date(simData);
    futuroLimit.setDate(futuroLimit.getDate() + 5);
    futuroLimit.setHours(23, 59, 59, 999);

    const invoices = await Invoice.find({
      school_id: schoolId,
      status: 'pending',
      dueDate: { $gte: limitPassado, $lte: futuroLimit }
    }).select('dueDate value description student tutor status gateway external_id boleto_url boleto_barcode');

    const forecast = {
      date: simData,
      total_expected: 0,
      breakdown: {
        due_today: 0,
        overdue: 0,
        reminder: 0
      }
    };

    for (const inv of invoices) {
      const check = this._checkEligibilityForDate(inv.dueDate, simData);
      if (check.shouldSend) {
        // ✅ NÃO conta se estiver em HOLD
        const onHold = await this._isInvoiceOnHold(inv);
        if (onHold) continue;

        forecast.total_expected++;
        forecast.breakdown[check.type]++;
      }
    }

    return forecast;
  }

  _checkEligibilityForDate(dueDate, referenceDate) {
    const ref = new Date(referenceDate); ref.setHours(0, 0, 0, 0);
    const venc = new Date(dueDate); venc.setHours(0, 0, 0, 0);

    const diffTime = venc - ref;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 3) return { shouldSend: true, type: 'reminder' };
    if (diffDays === 0) return { shouldSend: true, type: 'due_today' };
    if (diffDays < 0 && diffDays >= -60) return { shouldSend: true, type: 'overdue' };

    return { shouldSend: false, type: null };
  }

  isEligibleForSending(dueDate) {
    const check = this._checkEligibilityForDate(dueDate, new Date());
    return check.shouldSend;
  }

  async queueNotification({ schoolId, invoiceId, studentName, tutorName, phone, type = 'new_invoice' }) {
    try {
      const exists = await NotificationLog.exists({
        invoice_id: invoiceId,
        type: type,
        status: { $in: ['queued', 'processing'] }
      });

      if (exists) return;

      const newLog = await NotificationLog.create({
        school_id: schoolId,
        invoice_id: invoiceId,
        student_name: studentName,
        tutor_name: tutorName,
        target_phone: phone,
        type: type,
        status: 'queued',
        scheduled_for: new Date()
      });

      console.log(`📥 [Fila] + ADICIONADO: ${studentName} (${type})`);

      if (appEmitter && typeof appEmitter.emit === 'function') {
        appEmitter.emit('notification:created', newLog);
      }

    } catch (error) {
      console.error('❌ Erro ao enfileirar:', error);
    }
  }

  async scanAndQueueInvoices() {
    console.log('🔎 [Cron] INICIANDO VARREDURA INTELIGENTE');
    try {
      const activeConfigs = await NotificationConfig.find({ isActive: true });
      if (!activeConfigs.length) return;

      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      for (const config of activeConfigs) {
        const [startH, startM] = config.windowStart.split(':').map(Number);
        const [endH, endM] = config.windowEnd.split(':').map(Number);
        if (currentMinutes < (startH * 60 + startM) || currentMinutes >= (endH * 60 + endM)) continue;

        const schoolId = config.school_id;

        const hojeStart = new Date(); hojeStart.setHours(0, 0, 0, 0);
        const hojeEnd = new Date(); hojeEnd.setHours(23, 59, 59, 999);

        const limitPassado = new Date(); limitPassado.setDate(limitPassado.getDate() - 60); limitPassado.setHours(0, 0, 0, 0);

        const futuroStart = new Date(); futuroStart.setDate(futuroStart.getDate() + 3); futuroStart.setHours(0, 0, 0, 0);
        const futuroEnd = new Date(); futuroEnd.setDate(futuroEnd.getDate() + 3); futuroEnd.setHours(23, 59, 59, 999);

        const invoices = await Invoice.find({
          school_id: schoolId,
          status: 'pending',
          $or: [
            { dueDate: { $gte: limitPassado, $lte: hojeEnd } },
            { dueDate: { $gte: futuroStart, $lte: futuroEnd } }
          ]
        }).populate('student').populate('tutor');

        console.log(`📊 Escola ${schoolId}: ${invoices.length} faturas potenciais.`);

        for (const inv of invoices) {
          const check = this._checkEligibilityForDate(inv.dueDate, new Date());
          if (!check.shouldSend) continue;

          // ✅ NOVO: se estiver em HOLD, não entra na fila
          const onHold = await this._isInvoiceOnHold(inv);
          if (onHold) {
            console.log(`⛔ [HOLD] Ignorando invoice ${String(inv._id)} (em compensação/hold).`);
            continue;
          }

          const sentToday = await NotificationLog.exists({
            invoice_id: inv._id,
            createdAt: { $gte: hojeStart }
          });

          if (!sentToday) {
            await this._prepareAndQueue(inv, check.type);
          }
        }
      }
    } catch (e) {
      console.error("❌ Erro varredura:", e);
    }
  }

  async _prepareAndQueue(invoice, type) {
    let name, phone;
    if (invoice.tutor) {
      name = invoice.tutor.fullName;
      phone = invoice.tutor.phoneNumber || invoice.tutor.telefone;
    } else if (invoice.student) {
      name = invoice.student.fullName;
      phone = invoice.student.phoneNumber;
    }

    if (name && phone) {
      await this.queueNotification({
        schoolId: invoice.school_id,
        invoiceId: invoice._id,
        studentName: invoice.student?.fullName || 'Aluno',
        tutorName: name,
        phone: phone,
        type: type
      });
    }
  }

    /**
   * ✅ NOVO: reenfileirar manualmente uma invoice
   * - aplica a mesma regra de HOLD do cron
   */
  async enqueueInvoiceManually({ schoolId, invoice, type = 'manual' }) {
    const onHold = await this._isInvoiceOnHold(invoice);
    if (onHold) {
      return {
        ok: false,
        reason: 'HOLD_ACTIVE',
        message: 'Cobrança bloqueada: invoice está em compensação/HOLD ativo.'
      };
    }

    let name, phone;
    if (invoice.tutor) {
      name = invoice.tutor.fullName;
      phone = invoice.tutor.phoneNumber || invoice.tutor.telefone;
    } else if (invoice.student) {
      name = invoice.student.fullName;
      phone = invoice.student.phoneNumber;
    }

    if (!name || !phone) {
      return { ok: false, reason: 'MISSING_CONTACT', message: 'Tutor/aluno sem telefone válido.' };
    }

    await this.queueNotification({
      schoolId,
      invoiceId: invoice._id,
      studentName: invoice.student?.fullName || 'Aluno',
      tutorName: name,
      phone,
      type
    });

    // opcional: já dispara processamento
    // this.processQueue();

    return { ok: true, message: 'Invoice reenfileirada com sucesso.' };
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const logs = await NotificationLog.find({
        status: 'queued',
        scheduled_for: { $lte: new Date() }
      })
        .limit(1)
        .populate('invoice_id');

      if (logs.length > 0) console.log(`🔄 Processando lote de ${logs.length}...`);

      for (const log of logs) {
        log.status = 'processing';
        await log.save();
        if (appEmitter) appEmitter.emit('notification:updated', log);

        try {
          const delay = Math.floor(Math.random() * 15000) + 15000;
          console.log(`⏳ Aguardando ${Math.floor(delay / 1000)}s...`);
          await new Promise(r => setTimeout(r, delay));

          // ✅ agora pode retornar { skipped:true, ... } (por HOLD)
          const result = await this._sendSingleNotification(log);

          if (result?.skipped) {
            // ✅ Não marca como failed — finaliza como sent para não reprocessar
            log.status = 'sent';
            log.sent_at = new Date();
            log.error_message = null;

            // usa campos existentes para auditoria do motivo
            log.error_code = 'SKIPPED_HOLD';
            log.error_http_status = 200;
            log.error_raw = JSON.stringify({
              skipped: true,
              reason: result.reason,
              hold_until: result.hold_until || null
            }).slice(0, 2000);

            console.log(`⛔ [HOLD] SKIP envio (${log.tutor_name}) -> ${result.reason || 'HOLD ativo'}`);
          } else {
            log.status = 'sent';
            log.sent_at = new Date();
            log.error_message = null;

            log.error_code = null;
            log.error_http_status = null;
            log.error_raw = null;

            console.log(`✅ [Zap] Enviado: ${log.tutor_name}`);
          }

        } catch (error) {
          const normalized = this._normalizeWhatsappError(error);

          console.error(`❌ [Zap] Falha: ${log.tutor_name}`, normalized.message);

          log.status = 'failed';
          log.error_message = normalized.message;
          log.error_code = normalized.code;
          log.error_http_status = normalized.httpStatus;
          log.error_raw = normalized.raw;
          log.attempts += 1;
        }

        const finalLog = await log.save();
        if (appEmitter) appEmitter.emit('notification:updated', finalLog);
      }
    } catch (err) {
      console.error('Erro fila:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  async _sendSingleNotification(log) {
    const invoice = log.invoice_id;
    if (!invoice) throw new Error("Fatura não encontrada.");
    if (invoice.status === 'paid' || invoice.status === 'canceled') throw new Error("Fatura já paga/cancelada.");

    // ✅ NOVO: trava final — se está em HOLD, não envia
    // (mesmo que tenha entrado na fila antes)
    const onHold = await this._isInvoiceOnHold(invoice);
    if (onHold) {
      return {
        skipped: true,
        reason: 'Invoice está com compensação/HOLD ativo. Cobrança bloqueada até o fim do hold.',
      };
    }

    const school = await School.findById(log.school_id).select('name whatsapp').lean();
    const nomeEscola = school?.name || "Escola";

    if (!school?.whatsapp || school.whatsapp.status !== 'connected') {
      console.log(`⚠️ [Zap] Banco desconectado. Verificando API...`);
      const isReallyConnected = await whatsappService.ensureConnection(log.school_id);
      if (!isReallyConnected) {
        throw new Error("WhatsApp desconectado (Confirmado pela API).");
      }
      console.log(`✅ [Zap] Conexão ativa na API. Prosseguindo...`);
    }

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const venc = new Date(invoice.dueDate); venc.setHours(0, 0, 0, 0);
    const diff = (venc - hoje) / (1000 * 60 * 60 * 24);

    let list = TEMPLATES_HOJE;
    let templateGroup = 'HOJE';

    if (diff > 0) {
      list = TEMPLATES_FUTURO;
      templateGroup = 'FUTURO';
    } else if (diff < 0) {
      list = TEMPLATES_ATRASO;
      templateGroup = 'ATRASO';
    }

    const templateIndex = Math.floor(Math.random() * list.length);

    const text = list[templateIndex]
      .replace('{escola}', nomeEscola)
      .replace('{nome}', (log.tutor_name || '').split(' ')[0] || 'Olá')
      .replace('{descricao}', invoice.description)
      .replace('{valor}', (invoice.value / 100).toFixed(2).replace('.', ','))
      .replace('{vencimento}', venc.toLocaleDateString('pt-BR', { timeZone: 'UTC' }));

    log.template_group = templateGroup;
    log.template_index = templateIndex;
    log.message_text = text;
    log.message_preview = text.length > 140 ? `${text.slice(0, 140)}...` : text;

    // Snapshot
    log.sent_gateway = invoice.gateway || null;
    log.sent_gateway_charge_id = invoice.external_id ? String(invoice.external_id) : null;
    log.sent_boleto_url = invoice.boleto_url || null;
    log.sent_barcode = invoice.boleto_barcode || null;

    log.invoice_snapshot = {
      description: invoice.description || null,
      value: typeof invoice.value === 'number' ? invoice.value : null,
      dueDate: invoice.dueDate || null,
      student: invoice.student || null,
      tutor: invoice.tutor || null,
      gateway: invoice.gateway || null,
      external_id: invoice.external_id ? String(invoice.external_id) : null,
    };

    await log.save();
    if (appEmitter) appEmitter.emit('notification:updated', log);

    // 1) Envia Texto
    await whatsappService.sendText(log.school_id, log.target_phone, text);
    await new Promise(r => setTimeout(r, 2000));

    // 2) CORA: envia boleto
    if (invoice.gateway === 'cora' && invoice.boleto_url) {
      const safeName = (log.student_name || 'Aluno')
        .split(' ')[0]
        .replace(/[^a-zA-Z0-9]/g, '_');

      const dueKey = `${venc.getFullYear()}-${String(venc.getMonth() + 1).padStart(2, '0')}-${String(venc.getDate()).padStart(2, '0')}`;
      const fileName = `Boleto_${safeName}_${String(invoice._id)}_${dueKey}.pdf`;

      try {
        console.log(`📎 [Zap] Enviando PDF: ${fileName}`);
        await whatsappService.sendFile(
          log.school_id,
          log.target_phone,
          invoice.boleto_url,
          fileName,
          "📄 Segue o seu boleto."
        );
      } catch (e) {
        console.error("⚠️ Falha PDF:", e.message);
        await whatsappService.sendText(log.school_id, log.target_phone, `📄 Baixe aqui: ${invoice.boleto_url}`);
      }

      if (invoice.boleto_barcode) {
        const okBarcode = this._isLikelyValidBarcode(invoice.boleto_barcode);

        if (okBarcode) {
          await whatsappService.sendText(log.school_id, log.target_phone, String(invoice.boleto_barcode).trim());
        } else {
          log.error_code = log.error_code || 'BARCODE_INVALID_SUSPECT';
          log.error_message = log.error_message || 'Barcode com formato suspeito; envio bloqueado para evitar pagamento errado.';
          await log.save();
          if (appEmitter) appEmitter.emit('notification:updated', log);

          await whatsappService.sendText(
            log.school_id,
            log.target_phone,
            "⚠️ *Atenção:* não enviamos o código de barras por segurança. Use o link/PDF acima para pagamento."
          );
        }
      }

      return;
    }

    // 3) MercadoPago: Pix
    if (invoice.gateway === 'mercadopago') {
      const pix = invoice.pix_code || invoice.mp_pix_copia_e_cola;
      if (pix) {
        await whatsappService.sendText(log.school_id, log.target_phone, "💠 Pix Copia e Cola:");
        await whatsappService.sendText(log.school_id, log.target_phone, pix);
      }
    }
  }

  async getLogs(schoolId, status, page = 1, limit = 20, dateStr) {
    const query = { school_id: schoolId };
    if (status && status !== 'Todos') query.status = status;

    const { startOfDay, endOfDay } = this._getDayRange(dateStr);
    query.createdAt = { $gte: startOfDay, $lte: endOfDay };

    let dbQuery = NotificationLog.find(query).sort({ createdAt: -1 });

    const shouldPaginate = limit && limit !== 'all' && Number(limit) > 0;

    if (shouldPaginate) {
      const skip = (page - 1) * limit;
      dbQuery = dbQuery.skip(skip).limit(parseInt(limit));
    }

    const logs = await dbQuery.lean();
    const total = await NotificationLog.countDocuments(query);

    const pages = shouldPaginate ? Math.ceil(total / limit) : 1;

    return { logs, total, pages };
  }

  async retryAllFailed(schoolId, dateStr) {
    const { startOfDay, endOfDay } = this._getDayRange(dateStr);

    const failedLogs = await NotificationLog.find({
      school_id: schoolId,
      status: 'failed',
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });

    if (failedLogs.length === 0) {
      return { count: 0, message: "Nenhuma falha encontrada no dia selecionado." };
    }

    let count = 0;
    for (const log of failedLogs) {
      log.status = 'queued';
      log.error_message = null;
      log.error_code = null;
      log.error_http_status = null;
      log.error_raw = null;

      log.scheduled_for = new Date();

      await log.save();
      if (appEmitter) appEmitter.emit('notification:updated', log);

      count++;
    }

    console.log(`🔄 [Bulk Retry] ${count} mensagens re-enfileiradas.`);
    return { count, message: `${count} mensagens enviadas para a fila novamente.` };
  }

  async getConfig(schoolId) {
    let config = await NotificationConfig.findOne({ school_id: schoolId });
    if (!config) config = await NotificationConfig.create({ school_id: schoolId });
    return config;
  }

  async saveConfig(schoolId, data) {
    return await NotificationConfig.findOneAndUpdate(
      { school_id: schoolId },
      data,
      { new: true, upsert: true }
    );
  }
}

const service = new NotificationService();
cron.schedule('* * * * *', () => { service.processQueue(); });
cron.schedule('0 * * * *', () => { service.scanAndQueueInvoices(); });
module.exports = service;