const NotificationLog = require('../models/notification-log.model');
const Invoice = require('../models/invoice.model');
const School = require('../models/school.model');
const NotificationConfig = require('../models/notification-config.model');
const whatsappService = require('./whatsapp.service');
const cron = require('node-cron');
const mongoose = require('mongoose');

// Serviço de compensação/HOLD
const invoiceCompensationService = require('./invoiceCompensation.service');

// --- IMPORTAÇÃO SEGURA DO EVENT EMITTER ---
let appEmitter;
try {
  appEmitter = require('../../config/eventEmitter');
} catch (e) {
  try {
    appEmitter = require('../../loaders/eventEmitter');
  } catch (e2) {
    console.warn('⚠️ appEmitter não encontrado.');
  }
}

// Texto padrão para evitar cobranças indevidas por atraso de liquidação bancária
const AVISO_LIQUIDACAO =
  '\n\n_Obs: Se você já realizou o pagamento, por favor desconsidere esta mensagem. O banco pode levar até 3 dias úteis para processar a baixa em nosso sistema._';

const TEMPLATES_FUTURO = [
  `{saudacao} {nome}! Tudo bem? 😊\nPassando pra deixar o boleto da *{escola}* ({descricao}) já liberado pra você. Ele vence dia {vencimento}, mas sabemos que muita gente gosta de se organizar logo no início do mês!\nValor: R$ {valor}.${AVISO_LIQUIDACAO}`,
  `{saudacao}, {nome}! A mensalidade de *{descricao}* já está disponível no nosso sistema. 📚 Pra facilitar sua rotina, segue abaixo o código para pagamento (vence dia {vencimento}).${AVISO_LIQUIDACAO}`,
  `Oi {nome}, {saudacao}! A *{escola}* está enviando a fatura de *{descricao}*. Fique à vontade para pagar quando for melhor para você até o dia {vencimento}.${AVISO_LIQUIDACAO}`,
  `{saudacao}! Como estão as coisas por aí, {nome}? Seu boleto da *{escola}* ({descricao}) já foi gerado. Seguem os dados abaixo para sua organização financeira. 🚀${AVISO_LIQUIDACAO}`
];

const TEMPLATES_HOJE = [
  `{saudacao} {nome}! Um lembrete rápido da *{escola}*: a mensalidade de *{descricao}* vence *HOJE*! 🗓️ Deixei o link e o código aqui embaixo pra facilitar pra você.${AVISO_LIQUIDACAO}`,
  `Oi {nome}! Hoje é o dia do vencimento da sua fatura da *{escola}* (R$ {valor}). 🏫 Qualquer dúvida, estamos à disposição por aqui mesmo!${AVISO_LIQUIDACAO}`,
  `{saudacao}, {nome}! Passando pra lembrar que a fatura de *{descricao}* vence hoje. Para evitar juros amanhã, utilize os dados abaixo para pagamento rápido. ✨${AVISO_LIQUIDACAO}`
];

const TEMPLATES_ATRASO = [
  `{saudacao} {nome}, tudo bem? Notamos que a fatura de *{descricao}* da *{escola}* consta em aberto há {dias_atraso} dia(s). Aconteceu algum imprevisto? Segue o link atualizado caso precise. 🙏${AVISO_LIQUIDACAO}`,
  `Oi {nome}! A mensalidade da *{escola}* ({descricao}) acabou passando do vencimento no dia {vencimento} (estamos com {dias_atraso} dias de atraso). Para te ajudar a regularizar, geramos a linha digitável abaixo. Qualquer dificuldade, me chama!${AVISO_LIQUIDACAO}`,
  `{saudacao}! A *{escola}* informa que não identificamos o pagamento referente a *{descricao}*. Para evitar mais acréscimos (atraso de {dias_atraso} dias), o link abaixo já está atualizado. 🤝${AVISO_LIQUIDACAO}`
];

class NotificationService {
  constructor() {
    this.isProcessing = false;
  }

  // ✅ SAUDAÇÃO DINÂMICA
  _getSaudacao() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Bom dia';
    if (h >= 12 && h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  _parseLocalDateInput(dateValue) {
    if (!dateValue) return null;

    if (dateValue instanceof Date) {
      const clone = new Date(dateValue);
      return isNaN(clone.getTime()) ? null : clone;
    }

    const raw = String(dateValue).trim();
    if (!raw) return null;

    // Flutter envia YYYY-MM-DD. Parsear assim evita o deslocamento UTC do
    // new Date('YYYY-MM-DD'), que empurra o range para o dia anterior no BRT.
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const day = Number(match[3]);
      const localDate = new Date(year, month, day);
      return isNaN(localDate.getTime()) ? null : localDate;
    }

    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  _getDayRange(dateStr) {
    let base = new Date();
    if (dateStr) {
      const parsed = this._parseLocalDateInput(dateStr);
      if (parsed) base = parsed;
    }

    const startOfDay = new Date(base);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(base);
    endOfDay.setHours(23, 59, 59, 999);

    return { startOfDay, endOfDay };
  }

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

  _isLikelyValidBarcode(barcode) {
    if (!barcode) return false;
    const s = String(barcode).trim();
    const digitsOnly = s.replace(/\D/g, '');
    if (digitsOnly.length >= 44) return true;
    if (digitsOnly.length >= 47) return true;
    return false;
  }

  _buildSafeFileName(studentName, invoiceId, dueDate) {
    const safeName = (studentName || 'Aluno')
      .split(' ')[0]
      .replace(/[^a-zA-Z0-9]/g, '_');

    const venc = new Date(dueDate);
    const dueKey = `${venc.getFullYear()}-${String(venc.getMonth() + 1).padStart(2, '0')}-${String(venc.getDate()).padStart(2, '0')}`;

    return `Boleto_${safeName}_${String(invoiceId)}_${dueKey}.pdf`;
  }

  _isNotificationTypeEnabled(type, config) {
    if (!config) return true;

    const normalizedType = String(type || '').toLowerCase();

    if (normalizedType === 'due_today') {
      return config.enableDueToday !== false;
    }

    if (normalizedType === 'overdue') {
      return config.enableOverdue !== false;
    }

    if (normalizedType === 'reminder' || normalizedType === 'new_invoice') {
      return config.enableReminder !== false;
    }

    return true;
  }

  async _hasNotificationLogForInvoice({ schoolId, invoiceId }) {
    if (!schoolId || !invoiceId) return false;

    return NotificationLog.exists({
      school_id: schoolId,
      invoice_id: invoiceId,
    });
  }

  _composeSingleDeliveryMessage({ baseText, invoice }) {
    const sections = [];
    const addSection = (value) => {
      const normalized = String(value || '').trim();
      if (normalized) sections.push(normalized);
    };

    addSection(baseText);

    const barcode = invoice?.boleto_barcode ? String(invoice.boleto_barcode).trim() : null;
    const hasValidBarcode = this._isLikelyValidBarcode(barcode);
    const gateway = String(invoice?.gateway || '').toLowerCase();

    if (gateway === 'cora') {
      if (invoice?.boleto_url) {
        addSection(`📄 *Boleto em PDF / link para pagamento:*\n${invoice.boleto_url}`);
      }

      if (barcode) {
        if (hasValidBarcode) {
          addSection(`🔢 *Linha digitável:*\n${barcode}`);
        } else {
          addSection('⚠️ *Atenção:* por segurança, não enviamos a linha digitável. Utilize o PDF/link acima para concluir o pagamento.');
        }
      }

      return {
        text: sections.join('\n\n'),
        shouldTryFile: Boolean(invoice?.boleto_url),
      };
    }

    if (gateway === 'mercadopago') {
      const pix = invoice?.pix_code || invoice?.mp_pix_copia_e_cola;

      if (pix) {
        addSection(`💠 *Pix Copia e Cola:*\n${String(pix).trim()}`);
      }

      if (!pix && invoice?.boleto_url) {
        addSection(`🔗 *Link para pagamento:*\n${invoice.boleto_url}`);
      }

      if (!pix && barcode) {
        if (hasValidBarcode) {
          addSection(`🔢 *Linha digitável:*\n${barcode}`);
        } else {
          addSection('⚠️ *Atenção:* por segurança, não enviamos a linha digitável. Utilize o link de pagamento desta cobrança.');
        }
      }

      return {
        text: sections.join('\n\n'),
        shouldTryFile: false,
      };
    }

    if (invoice?.boleto_url) {
      addSection(`🔗 *Link para pagamento:*\n${invoice.boleto_url}`);
    }

    if (barcode) {
      if (hasValidBarcode) {
        addSection(`🔢 *Linha digitável:*\n${barcode}`);
      } else {
        addSection('⚠️ *Atenção:* por segurança, não enviamos a linha digitável. Utilize o link/PDF desta cobrança para concluir o pagamento.');
      }
    }

    return {
      text: sections.join('\n\n'),
      shouldTryFile: false,
    };
  }

  async _dispatchSingleMessage({ log, invoice, deliveryMessage }) {
    if (deliveryMessage.shouldTryFile && invoice?.boleto_url) {
      const fileName = this._buildSafeFileName(log.student_name, invoice._id, invoice.dueDate);

      try {
        console.log(`📎 [Zap] Enviando cobrança consolidada em documento: ${fileName}`);
        await whatsappService.sendFile(
          log.school_id,
          log.target_phone,
          invoice.boleto_url,
          fileName,
          deliveryMessage.text,
          {
            source: 'notification.service',
            notification_log_id: log._id,
            invoice_id: invoice?._id || null,
            school_id: log.school_id,
            notification_type: log.type,
            request_kind: 'document',
            fallback_from: null,
            template_group: log.template_group || null,
            template_index: log.template_index ?? null,
          }
        );
        return;
      } catch (e) {
        console.error('⚠️ Falha ao enviar documento consolidado. Fazendo fallback para texto único:', e?.message || e);
      }
    }

    await whatsappService.sendText(log.school_id, log.target_phone, deliveryMessage.text, {
      source: 'notification.service',
      notification_log_id: log._id,
      invoice_id: invoice?._id || null,
      school_id: log.school_id,
      notification_type: log.type,
      request_kind: 'text',
      fallback_from: deliveryMessage.shouldTryFile && invoice?.boleto_url ? 'document' : null,
      template_group: log.template_group || null,
      template_index: log.template_index ?? null,
    });
  }

  async _isInvoiceOnHold(invoice) {
    try {
      if (!invoice?._id || !invoice?.school_id) return false;

      const comp = await invoiceCompensationService.getCompensationByInvoice({
        school_id: invoice.school_id,
        invoice_id: invoice._id
      });

      return !!comp;
    } catch (e) {
      console.error('⚠️ Erro ao checar HOLD de compensação:', e?.message || e);
      return false;
    }
  }

  async getDailyStats(schoolId, dateStr) {
    const { startOfDay, endOfDay } = this._getDayRange(dateStr);

    let objectIdSchool;
    try {
      objectIdSchool = new mongoose.Types.ObjectId(schoolId);
    } catch (e) {
      console.error('ID da escola inválido para stats:', schoolId);
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
          _id: '$status',
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
    const parsedDate = this._parseLocalDateInput(targetDate);
    const simData = parsedDate || new Date();
    if (!parsedDate) {
      simData.setDate(simData.getDate() + 1);
    }
    simData.setHours(12, 0, 0, 0);

    const limitPassado = new Date(simData);
    limitPassado.setDate(limitPassado.getDate() - 60);
    limitPassado.setHours(0, 0, 0, 0);

    const futuroLimit = new Date(simData);
    futuroLimit.setDate(futuroLimit.getDate() + 5);
    futuroLimit.setHours(23, 59, 59, 999);

    // Forecast here is an operational preview of open debts eligible for the
    // next run, not a deduplicated send queue. The actual queue still prevents
    // duplicate notification logs elsewhere.
    const invoices = await Invoice.find({
      school_id: schoolId,
      status: { $in: ['pending', 'overdue'] },
      dueDate: { $gte: limitPassado, $lte: futuroLimit }
    }).select('dueDate value description student tutor status gateway external_id boleto_url boleto_barcode');

    const forecast = {
      date: simData,
      total_expected: 0,
      breakdown: {
        due_today: 0,
        overdue: 0,
        reminder: 0,
        new_invoice: 0
      }
    };

    for (const inv of invoices) {
      const check = this._checkEligibilityForDate(inv.dueDate, simData);
      if (check.shouldSend) {
        const onHold = await this._isInvoiceOnHold(inv);
        if (onHold) continue;

        forecast.total_expected++;
        if (forecast.breakdown[check.type] !== undefined) forecast.breakdown[check.type]++;
      }
    }

    return forecast;
  }

  _checkEligibilityForDate(dueDate, referenceDate) {
    const ref = new Date(referenceDate); ref.setHours(0, 0, 0, 0);
    const venc = new Date(dueDate); venc.setHours(0, 0, 0, 0);

    const diffTime = venc - ref;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // ✅ REGRA DO DIA 1º: Se hoje for dia 1 e a fatura vence no mesmo mês
    if (ref.getDate() === 1 && diffDays > 0 && diffDays <= 31 && venc.getMonth() === ref.getMonth()) {
      return { shouldSend: true, type: 'new_invoice' };
    }

    if (diffDays === 3) return { shouldSend: true, type: 'reminder' };
    if (diffDays === 0) return { shouldSend: true, type: 'due_today' };
    if (diffDays < 0 && diffDays >= -60) return { shouldSend: true, type: 'overdue' };

    return { shouldSend: false, type: null };
  }

  isEligibleForSending(dueDate) {
    const check = this._checkEligibilityForDate(dueDate, new Date());
    return check.shouldSend;
  }

  async queueNotification({
    schoolId,
    invoiceId,
    studentName,
    tutorName,
    phone,
    type = 'new_invoice',
    force = false,
  }) {
    try {
      if (!force) {
        const exists = await this._hasNotificationLogForInvoice({
          schoolId,
          invoiceId,
        });

        if (exists) {
          console.log(`↩️ [Fila] Ignorando duplicidade da invoice ${String(invoiceId)} (${type}).`);
          return {
            ok: false,
            skipped: true,
            reason: 'ALREADY_QUEUED_OR_SENT',
          };
        }
      }

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

      return {
        ok: true,
        log: newLog,
      };

    } catch (error) {
      console.error('❌ Erro ao enfileirar:', error);
      return {
        ok: false,
        skipped: false,
        error,
      };
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

        // ✅ Adiciona limite até fim do mês se for dia 1º
        const orConditions = [
          { dueDate: { $gte: limitPassado, $lte: hojeEnd } },
          { dueDate: { $gte: futuroStart, $lte: futuroEnd } }
        ];

        if (now.getDate() === 1) {
          const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
          orConditions.push({ dueDate: { $gte: hojeStart, $lte: monthEnd } });
        }

        const invoices = await Invoice.find({
          school_id: schoolId,
          status: 'pending',
          $or: orConditions
        }).populate('student').populate('tutor');

        console.log(`📊 Escola ${schoolId}: ${invoices.length} faturas potenciais.`);

        for (const inv of invoices) {
          const check = this._checkEligibilityForDate(inv.dueDate, new Date());
          if (!check.shouldSend) continue;

          if (!this._isNotificationTypeEnabled(check.type, config)) {
            console.log(`⏭️ [Config] Tipo ${check.type} desabilitado para a escola ${String(schoolId)}.`);
            continue;
          }

          const onHold = await this._isInvoiceOnHold(inv);
          if (onHold) {
            console.log(`⛔ [HOLD] Ignorando invoice ${String(inv._id)} (em compensação/hold).`);
            continue;
          }

          const alreadyNotified = await this._hasNotificationLogForInvoice({
            schoolId,
            invoiceId: inv._id,
          });

          if (!alreadyNotified) {
            await this._prepareAndQueue(inv, check.type);
          }
        }
      }
    } catch (e) {
      console.error('❌ Erro varredura:', e);
    }
  }

  // ✅ NOVO: GATILHO MANUAL DO MÊS (Para resolver o dia 2, 3, etc)
  async queueMonthInvoicesManually(schoolId) {
    const hojeStart = new Date(); hojeStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(hojeStart.getFullYear(), hojeStart.getMonth() + 1, 0, 23, 59, 59, 999);

    const invoices = await Invoice.find({
      school_id: schoolId,
      status: 'pending',
      dueDate: { $gte: hojeStart, $lte: monthEnd }
    }).populate('student').populate('tutor');

    let count = 0;
    for (const inv of invoices) {
      const onHold = await this._isInvoiceOnHold(inv);
      if (onHold) continue;

      // Garante que não manda se já existe qualquer aviso para essa fatura (evita spam)
      const alreadyNotified = await this._hasNotificationLogForInvoice({
        schoolId,
        invoiceId: inv._id,
      });

      if (!alreadyNotified) {
        await this._prepareAndQueue(inv, 'new_invoice');
        count++;
      }
    }
    return count;
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
      type,
      force: true
    });

    return { ok: true, message: 'Invoice reenfileirada com sucesso.' };
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date();

      const queuedCandidates = await NotificationLog.find({
        status: 'queued',
        scheduled_for: { $lte: now }
      })
        .sort({ createdAt: 1 })
        .select('_id school_id createdAt scheduled_for')
        .lean();

      if (queuedCandidates.length === 0) {
        return;
      }

      const schoolIds = [...new Set(
        queuedCandidates
          .map((item) => String(item.school_id || '').trim())
          .filter(Boolean)
      )];

      const activeConfigs = schoolIds.length > 0
        ? await NotificationConfig.find({
            school_id: { $in: schoolIds },
            isActive: true,
          })
            .select('school_id')
            .lean()
        : [];

      const activeSchoolIds = new Set(
        activeConfigs.map((config) => String(config.school_id))
      );

      const nextCandidate = queuedCandidates.find((item) =>
        activeSchoolIds.has(String(item.school_id))
      );

      if (!nextCandidate) {
        console.log('⏸️ [Fila] Nenhuma mensagem elegível para envio. Todas as escolas pendentes estão pausadas.');
        return;
      }

      const log = await NotificationLog.findOneAndUpdate(
        {
          _id: nextCandidate._id,
          status: 'queued',
        },
        {
          $set: {
            status: 'processing',
          },
        },
        {
          new: true,
        }
      ).populate('invoice_id');

      if (!log) {
        return;
      }

      console.log(`🔄 Processando lote de 1...`);
      if (appEmitter) appEmitter.emit('notification:updated', log);

      try {
        const delay = Math.floor(Math.random() * 15000) + 15000;
        console.log(`⏳ Aguardando ${Math.floor(delay / 1000)}s...`);
        await new Promise(r => setTimeout(r, delay));

        // Revalida a pausa aqui porque a fila pode ter sido suspensa enquanto o worker aguardava.
        const schoolStillActive = await NotificationConfig.findOne({
          school_id: log.school_id,
          isActive: true,
        })
          .select('_id')
          .lean();

        if (!schoolStillActive) {
          log.status = 'queued';
          log.sent_at = null;
          log.error_message = null;
          log.error_code = null;
          log.error_http_status = null;
          log.error_raw = null;

          const pausedLog = await log.save();
          if (appEmitter) appEmitter.emit('notification:updated', pausedLog);

          console.log(`⏸️ [Fila] Envio suspenso antes do disparo (${log.tutor_name}) porque a escola foi pausada.`);
          return;
        }

        const result = await this._sendSingleNotification(log);

        if (result?.skipped) {
          log.status = 'sent';
          log.sent_at = new Date();
          log.error_message = null;

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
    } catch (err) {
      console.error('Erro fila:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  async _sendSingleNotification(log) {
    const invoice = log.invoice_id;
    if (!invoice) throw new Error('Fatura não encontrada.');
    if (invoice.status === 'paid' || invoice.status === 'canceled') throw new Error('Fatura já paga/cancelada.');

    const onHold = await this._isInvoiceOnHold(invoice);
    if (onHold) {
      return {
        skipped: true,
        reason: 'Invoice está com compensação/HOLD ativo. Cobrança bloqueada até o fim do hold.',
      };
    }

    const school = await School.findById(log.school_id).select('name whatsapp').lean();
    const nomeEscola = school?.name || 'Escola';

    if (!school?.whatsapp || school.whatsapp.status !== 'connected') {
      console.log('⚠️ [Zap] Banco desconectado. Verificando API...');
      const isReallyConnected = await whatsappService.ensureConnection(log.school_id);
      if (!isReallyConnected) {
        throw new Error('WhatsApp desconectado (Confirmado pela API).');
      }
      console.log('✅ [Zap] Conexão ativa na API. Prosseguindo...');
    }

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const venc = new Date(invoice.dueDate); venc.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((venc - hoje) / (1000 * 60 * 60 * 24));

    // DADOS DINÂMICOS
    const diasAtraso = diffDays < 0 ? Math.abs(diffDays) : 0;
    const saudacao = this._getSaudacao();

    let list = TEMPLATES_HOJE;
    let templateGroup = 'HOJE';

    if (diffDays > 0) {
      list = TEMPLATES_FUTURO;
      templateGroup = 'FUTURO';
    } else if (diffDays < 0) {
      list = TEMPLATES_ATRASO;
      templateGroup = 'ATRASO';
    }

    const templateIndex = Math.floor(Math.random() * list.length);

    const baseText = list[templateIndex]
      .replace(/{escola}/g, nomeEscola)
      .replace(/{nome}/g, (log.tutor_name || '').split(' ')[0] || 'Olá')
      .replace(/{descricao}/g, invoice.description)
      .replace(/{valor}/g, (invoice.value / 100).toFixed(2).replace('.', ','))
      .replace(/{vencimento}/g, venc.toLocaleDateString('pt-BR', { timeZone: 'UTC' }))
      .replace(/{saudacao}/g, saudacao)
      .replace(/{dias_atraso}/g, diasAtraso);

    const deliveryMessage = this._composeSingleDeliveryMessage({
      baseText,
      invoice,
    });

    log.template_group = templateGroup;
    log.template_index = templateIndex;
    log.message_text = deliveryMessage.text;
    log.message_preview = deliveryMessage.text.length > 140
      ? `${deliveryMessage.text.slice(0, 140)}...`
      : deliveryMessage.text;

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

    await this._dispatchSingleMessage({
      log,
      invoice,
      deliveryMessage,
    });
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
      return { count: 0, message: 'Nenhuma falha encontrada no dia selecionado.' };
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
