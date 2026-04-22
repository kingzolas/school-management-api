// src/api/services/invoice.service.js
const Invoice = require('../models/invoice.model.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const School = require('../models/school.model.js');
const whatsappService = require('./whatsapp.service.js');
const NotificationService = require('./notification.service.js');
const financeRuntime = require('./school-finance.runtime.js');
const GatewayFactory = require('../gateways/gateway.factory.js');
const tutorFinancialScoreService = require('./tutorFinancialScore.service.js');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const https = require('https');
const { PDFDocument } = require('pdf-lib');
const {
  normalizeBarcode,
  normalizeDigitableLine,
} = require('../utils/boleto.util');

const FINANCE_VERBOSE_LOGS = process.env.FINANCE_VERBOSE_LOGS === 'true';
const financeDebugLog = (...args) => {
  if (FINANCE_VERBOSE_LOGS) {
    console.log(...args);
  }
};

class InvoiceService {

  async createInvoice(invoiceData, schoolId) {
    const { studentId, value, dueDate, description, tutorId, gateway: chosenGateway, sendNow } = invoiceData;

    const selectString = [
      '+mercadoPagoConfig.prodAccessToken',
      '+mercadoPagoConfig.prodClientId',
      '+mercadoPagoConfig.prodClientSecret',
      'coraConfig.isSandbox',
      'coraConfig.sandbox.clientId',
      '+coraConfig.sandbox.certificateContent',
      '+coraConfig.sandbox.privateKeyContent',
      'coraConfig.production.clientId',
      '+coraConfig.production.certificateContent',
      '+coraConfig.production.privateKeyContent',
      'name'
    ].join(' ');

    const school = await School.findById(schoolId).select(selectString).lean();
    if (!school) throw new Error('Escola não encontrada.');

    const student = await Student.findOne({ _id: studentId, school_id: schoolId })
      .populate('financialTutorId');

    if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

    const rawAddr = student.address || {};
    let cleanZip = (rawAddr.zipCode || rawAddr.cep || '').replace(/\D/g, '');
    if (cleanZip.length !== 8) cleanZip = '01310100';

    const cleanAddress = {
      street: rawAddr.street || 'Rua não informada',
      number: rawAddr.number || '0',
      district: rawAddr.neighborhood || rawAddr.district || 'Bairro',
      city: rawAddr.city || 'São Paulo',
      state: (rawAddr.state && rawAddr.state.length === 2) ? rawAddr.state : 'SP',
      zip_code: cleanZip
    };

    let payerName, payerCpf, payerEmail, payerPhone;
    let linkedTutorId = null;

    if (student.financialResp === 'STUDENT') {
      if (!student.cpf) throw new Error('Aluno responsável sem CPF cadastrado.');
      payerName = student.fullName;
      payerCpf = student.cpf;
      payerEmail = student.email;
      payerPhone = student.phoneNumber;
      linkedTutorId = null;
    } else {
      let targetTutor = null;
      if (tutorId) {
        targetTutor = await Tutor.findOne({ _id: tutorId, school_id: schoolId });
      } else if (student.financialTutorId) {
        targetTutor = student.financialTutorId;
      }

      if (!targetTutor) throw new Error('Nenhum tutor responsável encontrado.');
      if (!targetTutor.cpf || targetTutor.cpf.length < 11) throw new Error('Tutor responsável sem CPF válido.');

      payerName = targetTutor.fullName;
      payerCpf = targetTutor.cpf;
      payerEmail = targetTutor.email;
      payerPhone = targetTutor.phoneNumber || targetTutor.telefone || targetTutor.celular;
      linkedTutorId = targetTutor._id;
    }

    const gateway = await GatewayFactory.create(school, chosenGateway);

    const finalEmail = (payerEmail && payerEmail.includes('@'))
      ? payerEmail.trim()
      : "pagador_sem_email@academyhub.com";

    const tempId = new Invoice()._id;

    const paymentPayload = {
      internalId: tempId,
      value: value,
      description: description,
      dueDate: dueDate,
      schoolId: schoolId,
      payer: {
        name: payerName,
        cpf: payerCpf,
        email: finalEmail,
        address: cleanAddress
      }
    };

    try {
      console.log(`[InvoiceService] Gerando cobrança via ${gateway.constructor.name}...`, {
        schoolId,
        studentId,
        gateway: chosenGateway,
        value,
        dueDate
      });

      const result = await gateway.createInvoice(paymentPayload);

      console.log('[InvoiceService] Gateway createInvoice retornou:', {
        gateway: result?.gateway,
        external_id: result?.external_id,
        boleto_url: !!result?.boleto_url
      });

      const bestBarcode = normalizeBarcode(result.boleto_barcode || result.barcode);
      const bestDigitableLine = normalizeDigitableLine(
        result.boleto_digitable_line ||
        result.boleto_digitable ||
        result.digitable_line ||
        result.digitable
      );

      const newInvoice = new Invoice({
        _id: tempId,
        student: studentId,
        tutor: linkedTutorId,
        school_id: schoolId,
        description,
        value: value,
        dueDate: dueDate,
        status: 'pending',
        gateway: result.gateway,
        external_id: result.external_id,
        boleto_url: result.boleto_url,
        boleto_barcode: bestBarcode,
        boleto_digitable_line: bestDigitableLine,
        pix_code: result.pix_code,
        pix_qr_base64: result.pix_qr_base64,
        mp_payment_id: result.gateway === 'mercadopago' ? result.external_id : undefined,
        mp_pix_copia_e_cola: result.pix_code,
        mp_ticket_url: result.boleto_url
      });

      await newInvoice.save();
      financeRuntime.invalidateSchool(schoolId);
      NotificationService.invalidateForecastCache({ schoolId });

      try {
        const isAutoEligible = NotificationService.isEligibleForSending(newInvoice.dueDate);
        const shouldSendNow = isAutoEligible || (sendNow === true);

        if (shouldSendNow) {
          const invoiceForDispatch = await Invoice.findById(newInvoice._id)
            .populate('student')
            .populate('tutor');

          await NotificationService.enqueueInvoiceManually({
            schoolId,
            invoice: invoiceForDispatch,
            type: 'new_invoice',
            dispatchOrigin: 'invoice_create',
          });
        }
      } catch (queueError) {
          console.error('⚠️ [InvoiceService] Erro ao tentar enfileirar (não bloqueante):', queueError.message);
        }

      // Recalcula score apenas se essa cobrança já nasceu vencida ou vencendo hoje.
      if (linkedTutorId) {
        const due = new Date(dueDate);
        const now = new Date();
        if (!Number.isNaN(due.getTime()) && due.getTime() <= now.getTime()) {
          try {
            await tutorFinancialScoreService.calculateTutorScore(linkedTutorId, schoolId);
          } catch (scoreError) {
            console.error('⚠️ [InvoiceService] Erro ao recalcular score após createInvoice (não bloqueante):', scoreError.message);
          }
        }
      }

      return await this.getInvoiceById(newInvoice._id, schoolId);

    } catch (error) {
      console.error('❌ [InvoiceService] ERRO Create Invoice (Raw):', error.message);
      const friendlyError = this._translateGatewayError(error, payerName);
      throw new Error(friendlyError);
    }
  }

  async resendNotification(invoiceId, schoolId) {
    const invoice = await Invoice.findOne({
      _id: invoiceId,
      school_id: schoolId,
    })
      .populate('student')
      .populate('tutor');

    if (!invoice) throw new Error('Fatura não encontrada.');
    if (invoice.status === 'paid' || invoice.status === 'canceled') {
      throw new Error('Fatura já paga/cancelada.');
    }

    const result = await NotificationService.enqueueInvoiceManually({
      schoolId,
      invoice,
      type: 'manual',
      force: true,
      dispatchOrigin: 'manual_force',
    });

    if (!result?.ok) {
      throw new Error(result?.message || 'Não foi possível reenfileirar a mensagem.');
    }

    NotificationService.processQueue({ schoolId });

    return {
      ok: true,
      message: 'Notificacao reenfileirada com sucesso.',
    };
  }

  async resendNotificationWithOutcome(invoiceId, schoolId) {
    const invoice = await Invoice.findOne({
      _id: invoiceId,
      school_id: schoolId,
    })
      .populate('student')
      .populate('tutor');

    if (!invoice) {
      return {
        success: true,
        status: 'failed',
        code: 'INVOICE_NOT_FOUND',
        category: 'business_rule',
        title: 'Fatura nao encontrada',
        user_message: 'Nao foi possivel localizar a cobranca solicitada.',
        technical_message: 'Invoice nao encontrada para reenvio manual.',
        retryable: false,
        field: null,
        item_id: invoiceId,
        invoice_id: invoiceId,
      };
    }

    if (!invoice) {
      return {
        success: true,
        status: 'failed',
        code: 'INVOICE_NOT_FOUND',
        category: 'business_rule',
        title: 'Fatura nÃ£o encontrada',
        user_message: 'NÃ£o foi possÃ­vel localizar a cobranÃ§a solicitada.',
        technical_message: 'Invoice nÃ£o encontrada para reenvio manual.',
        retryable: false,
        field: null,
        item_id: invoiceId,
        invoice_id: invoiceId,
      };
    }

    return NotificationService.enqueueInvoiceManually({
      schoolId,
      invoice,
      type: 'manual',
      force: true,
      dispatchOrigin: 'manual_force',
      processNow: true,
    });
  }

  async processDailyReminders() {
    await NotificationService.scanAndQueueInvoices({
      dispatchOrigin: 'daily_reminder',
    });
    NotificationService.processQueue();

    return {
      ok: true,
      message: 'Varredura de lembretes iniciada com sucesso.',
    };
  }

  _scheduleFinanceSync(schoolId, { reason = 'background_refresh', force = false, studentId = null, singleInvoiceId = null } = {}) {
    if (!schoolId) return { scheduled: false, reason: 'missing_school' };

    const gate = financeRuntime.shouldAllowSync(schoolId, { force });

    if (!gate.allowed) {
      financeDebugLog(`🟡 [InvoiceService] Sync não agendada para escola ${schoolId}`, {
        reason: gate.reason,
        force,
      });

      return {
        scheduled: false,
        reason: gate.reason,
        state: gate.state,
      };
    }

    financeDebugLog(`🕒 [InvoiceService] Sync em background agendada`, {
      schoolId,
      reason,
      force,
    });

    setImmediate(() => {
      this.syncPendingInvoices(studentId, schoolId, singleInvoiceId, { force, reason })
        .catch((error) => {
          console.error(`⚠️ [InvoiceService] Background finance sync falhou (${reason}):`, error.message);
        });
    });

    return {
      scheduled: true,
      reason,
    };
  }

  _shouldRefreshInvoiceList(filters = {}) {
    const status = String(filters?.status || '').trim().toLowerCase();

    if (!status) return true;
    return ['pending', 'overdue'].includes(status);
  }

  async _runLimitedConcurrency(items = [], limit = 5, handler = async () => {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    const maxConcurrency = Math.max(1, Math.min(Number(limit) || 1, items.length));
    let cursor = 0;

    const workers = Array.from({ length: maxConcurrency }, async () => {
      while (cursor < items.length) {
        const currentIndex = cursor++;
        const currentItem = items[currentIndex];
        await handler(currentItem, currentIndex);
      }
    });

    await Promise.all(workers);
  }

  _parseProviderDateValue(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'number') {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;

      // Cora date precedence:
      // occurrence_date -> finalized_at -> paid_at.
      // Date-only values do not carry timezone, so we anchor them at noon UTC
      // to preserve the business day when rendered in local timezones.
      const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnlyMatch) {
        const [, yearRaw, monthRaw, dayRaw] = dateOnlyMatch;
        const d = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw), 12, 0, 0, 0));
        return Number.isNaN(d.getTime()) ? null : d;
      }

      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    return null;
  }

  _normalizeInvoiceCachePayload(value = {}) {
    const normalized = {};

    for (const key of Object.keys(value).sort()) {
      const currentValue = value[key];
      if (currentValue === undefined || currentValue === null || currentValue === '') continue;
      normalized[key] = String(currentValue);
    }

    return normalized;
  }

  _normalizeOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  _buildGatewayBankSlipPatch(currentInvoice = {}, providerInfo = {}) {
    const patch = {};

    const nextBoletoUrl = this._normalizeOptionalString(providerInfo?.boleto_url);
    const nextBarcode = normalizeBarcode(providerInfo?.boleto_barcode);
    const nextDigitableLine = normalizeDigitableLine(
      providerInfo?.boleto_digitable_line ||
      providerInfo?.boleto_digitable ||
      providerInfo?.digitable_line ||
      providerInfo?.digitable
    );

    if (nextBoletoUrl && nextBoletoUrl !== this._normalizeOptionalString(currentInvoice?.boleto_url)) {
      patch.boleto_url = nextBoletoUrl;
    }

    if (nextBarcode && nextBarcode !== this._normalizeOptionalString(currentInvoice?.boleto_barcode)) {
      patch.boleto_barcode = nextBarcode;
    }

    if (nextDigitableLine && nextDigitableLine !== this._normalizeOptionalString(currentInvoice?.boleto_digitable_line)) {
      patch.boleto_digitable_line = nextDigitableLine;
    }

    return patch;
  }

  _translateGatewayError(error, payerName = 'o responsável') {
    let errorData = null;

    if (error.response && error.response.data) {
      errorData = error.response.data;
    } else {
      try {
        const match = error.message.match(/\{.*\}/);
        if (match) errorData = JSON.parse(match[0]);
      } catch (e) { /* ignora */ }
    }

    if (errorData && errorData.errors && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
      const err = errorData.errors[0];
      const code = (err.code || '').toLowerCase();
      const msg = (err.message || '').toLowerCase();

      if (code === 'customer.email' || msg.includes('email')) {
        return `O e-mail do Responsável Financeiro (${payerName}) é inválido ou mal formatado. Corrija o cadastro.`;
      }
      if (code === 'customer.document' || code === 'customer.document.identity' || msg.includes('cpf') || msg.includes('cnpj')) {
        return `O CPF/CNPJ do Responsável (${payerName}) é inválido. Verifique se os números estão corretos.`;
      }
      if (code === 'customer.name' || msg.includes('name')) {
        return `O nome do Responsável (${payerName}) está incompleto ou inválido para o banco.`;
      }
      if (code === 'services.amount' || msg.includes('amount')) {
        return `O valor da cobrança é inválido (deve ser maior que zero).`;
      }
      if (code === 'payment_options.due_date' || msg.includes('due_date')) {
        return `A data de vencimento é inválida ou antiga demais para registro.`;
      }

      return `Erro no Banco Cora: ${err.message}`;
    }

    const errorString = (error.message || '').toLowerCase();

    if (errorString.includes('customer.email')) return `E-mail do responsável (${payerName}) inválido.`;
    if (errorString.includes('customer.document')) return `CPF do responsável (${payerName}) inválido.`;
    if (errorString.includes('socket hang up') || errorString.includes('econneused')) return 'Erro de conexão com o banco. Tente novamente.';

    return error.message.replace('Erro Cora Create:', '').trim() || 'Erro desconhecido ao comunicar com o banco.';
  }

  async cancelInvoice(invoiceId, schoolId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, school_id: schoolId });
    if (!invoice) throw new Error('Fatura não encontrada');
    if (invoice.status === 'paid') throw new Error('Fatura já PAGA não pode ser cancelada.');

    const school = await School.findById(schoolId).lean();
    const gatewayName = invoice.gateway === 'cora' ? 'CORA' : 'MERCADOPAGO';

    try {
      const gateway = await GatewayFactory.create(school, gatewayName);
      if (invoice.external_id) await gateway.cancelInvoice(invoice.external_id);
    } catch (error) {
      console.warn(`Erro ao cancelar no gateway (${gatewayName}):`, error.message);
    }

    invoice.status = 'canceled';
    await invoice.save();
    NotificationService.invalidateForecastCache({ schoolId });

    if (invoice.tutor) {
      try {
        await tutorFinancialScoreService.calculateTutorScore(invoice.tutor, schoolId);
      } catch (scoreError) {
        console.error('⚠️ [InvoiceService] Erro ao recalcular score após cancelInvoice (não bloqueante):', scoreError.message);
      }
    }

    financeRuntime.invalidateSchool(schoolId);

    return invoice;
  }

  async handlePaymentWebhook(externalId, providerName, statusRaw, paidAtRaw = null) {
    const hookRunId = `${providerName || 'PROVIDER'}-${Date.now()}`;

    financeDebugLog(`\n🔔 [handlePaymentWebhook ${hookRunId}] chamado`, {
      externalId: String(externalId),
      providerName,
      statusRaw: statusRaw ?? null,
      paidAtRaw: paidAtRaw ?? null
    });

    let invoice = await Invoice.findOne({
      $or: [{ external_id: externalId }, { mp_payment_id: externalId }]
    });

    if (!invoice) {
      console.warn(`⚠️ [handlePaymentWebhook ${hookRunId}] invoice não encontrada no DB`, { externalId: String(externalId) });
      return { processed: false, updated: false, reason: 'not_found' };
    }

    if ((!statusRaw || statusRaw === null) && String(providerName).toUpperCase().includes('MERCADO_PAGO')) {
      try {
        const school = await School.findById(invoice.school_id).select('+mercadoPagoConfig.prodAccessToken').lean();
        const mpToken = school?.mercadoPagoConfig?.prodAccessToken;

        if (mpToken) {
          const res = await axios.get(`https://api.mercadopago.com/v1/payments/${externalId}`, {
            headers: { Authorization: `Bearer ${mpToken}` },
            timeout: 20000
          });

          statusRaw = res.data?.status || null;

          const mpPaidAt = res.data?.date_approved || res.data?.dateApproved || null;
          if (!paidAtRaw && mpPaidAt) paidAtRaw = mpPaidAt;
        }
      } catch (e) {
        console.error(`❌ [handlePaymentWebhook ${hookRunId}] erro consultando MP:`, e.message);
      }
    }

    let novoStatus = invoice.status;

    const statusPago = ['approved', 'paid', 'COMPLETED', 'LIQUIDATED', 'PAID'];
    const statusCancelado = ['cancelled', 'rejected', 'CANCELED', 'canceled', 'CANCELLED'];

    if (statusRaw) {
      const s = String(statusRaw);
      const sl = s.toLowerCase();

      if (statusPago.includes(s) || statusPago.includes(sl) || sl === 'paid') {
        novoStatus = 'paid';
      } else if (statusCancelado.includes(s) || statusCancelado.includes(sl)) {
        novoStatus = 'canceled';
      }
    }

    const paidAtParsed = this._parseProviderDateValue(paidAtRaw);

    let wasUpdated = false;

    const shouldUpdatePaidAt =
      novoStatus === 'paid' &&
      (paidAtParsed && (!invoice.paidAt || invoice.paidAt.getTime() !== paidAtParsed.getTime()));

    if (invoice.status !== novoStatus || shouldUpdatePaidAt) {
      const oldStatus = invoice.status;

      invoice.status = novoStatus;

      if (novoStatus === 'paid') {
        // Never invent paidAt here. If the provider did not send a trusted
        // timestamp, preserve the existing value or keep it null.
        if (paidAtParsed) invoice.paidAt = paidAtParsed;
      }

      await invoice.save();
      financeRuntime.invalidateSchool(invoice.school_id);
      NotificationService.invalidateForecastCache({ schoolId: invoice.school_id });

      console.log(`✅ [DB UPDATE ${hookRunId}] Fatura ${invoice._id} atualizada`, {
        oldStatus,
        newStatus: novoStatus,
        paidAt: invoice.paidAt || null,
        providerName
      });

      wasUpdated = true;

      if (invoice.tutor) {
        try {
          await tutorFinancialScoreService.calculateTutorScore(invoice.tutor, invoice.school_id);
        } catch (scoreError) {
          console.error('⚠️ [InvoiceService] Erro ao recalcular score após webhook (não bloqueante):', scoreError.message);
        }
      }
    } else {
      financeDebugLog(`🟡 [handlePaymentWebhook ${hookRunId}] Nenhuma alteração necessária`, {
        invoiceId: String(invoice._id),
        status: invoice.status,
        paidAt: invoice.paidAt || null
      });
    }

    return { processed: true, updated: wasUpdated, invoice, newStatus: novoStatus };
  }

  async generateBatchPdf(invoiceIds, schoolId) {
    const invoices = await Invoice.find({
      _id: { $in: invoiceIds },
      school_id: schoolId,
      $or: [
        { boleto_url: { $exists: true, $ne: null } },
        { mp_ticket_url: { $exists: true, $ne: null } }
      ]
    });

    if (!invoices.length) throw new Error("Nenhuma fatura com boleto/PDF encontrada.");

    const mergedPdf = await PDFDocument.create();
    let processedCount = 0;

    for (const inv of invoices) {
      const url = inv.boleto_url || inv.mp_ticket_url;
      if (!url) continue;

      try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const invoicePdf = await PDFDocument.load(response.data);
        const copiedPages = await mergedPdf.copyPages(invoicePdf, invoicePdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        processedCount++;
      } catch (error) {
        console.error(`Erro ao baixar/processar boleto ${inv._id}:`, error.message);
      }
    }

    if (processedCount === 0) throw new Error("Falha ao processar arquivos PDF.");

    return await mergedPdf.save();
  }

  _fmtMonthKeyFromDate(d) {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = String(dt.getFullYear());
    return `${mm}/${yyyy}`;
  }

  async syncPendingInvoices(studentId, schoolId, singleInvoiceId = null, options = {}) {
    const syncStart = financeRuntime.tryStartSync(schoolId, {
      force: options.force === true,
      reason: options.reason || 'sync_pending_invoices',
    });

    if (!syncStart.started) {
      financeDebugLog(`\n🟡 [sync-${schoolId}-${Date.now()}] Sync ignorado`, {
        schoolId,
        studentId: studentId || null,
        singleInvoiceId: singleInvoiceId || null,
        reason: syncStart.reason,
      });

      return {
        totalChecked: 0,
        updatedCount: 0,
        details: [],
        skipped: true,
        reason: syncStart.reason,
        syncState: syncStart.state,
      };
    }

    const syncRunId = `sync-${schoolId}-${Date.now()}`;
    const startedAt = Date.now();

    const filter = {
      school_id: schoolId,
      status: { $in: ['pending', 'overdue'] },
      gateway: { $in: ['mercadopago', 'cora'] },
      external_id: { $exists: true, $ne: null }
    };

    if (studentId) filter.student = studentId;
    if (singleInvoiceId) filter._id = singleInvoiceId;

    financeDebugLog(`\n🔄 [${syncRunId}] Iniciando syncPendingInvoices`, {
      schoolId,
      studentId: studentId || null,
      singleInvoiceId: singleInvoiceId || null
    });

    let stats = { totalChecked: 0, updatedCount: 0, details: [] };
    let syncError = null;

    try {
      const pendingInvoices = await Invoice.find(filter).lean();
      stats = { totalChecked: pendingInvoices.length, updatedCount: 0, details: [] };

    const coraPendings = pendingInvoices.filter(i => i.gateway === 'cora');
    const mpPendings = pendingInvoices.filter(i => i.gateway === 'mercadopago');

    financeDebugLog(`📌 [${syncRunId}] Pendentes no DB`, {
      total: pendingInvoices.length,
      cora: coraPendings.length,
      mercadopago: mpPendings.length
    });

    const tutorsToRecalculate = new Set();

    // --- CORA BULK ---
    let coraGateway = null;
    let bulkPaidIdsStr = [];

    try {
      const selectString = [
        'coraConfig.isSandbox',
        'coraConfig.sandbox.clientId',
        '+coraConfig.sandbox.certificateContent',
        '+coraConfig.sandbox.privateKeyContent',
        'coraConfig.production.clientId',
        '+coraConfig.production.certificateContent',
        '+coraConfig.production.privateKeyContent'
      ].join(' ');

      const school = await School.findById(schoolId).select(selectString).lean();
      const hasCora = !!(school?.coraConfig?.production?.clientId || school?.coraConfig?.sandbox?.clientId);

      if (hasCora && coraPendings.length > 0) {
        coraGateway = await GatewayFactory.create(school, 'CORA');

        if (typeof coraGateway.getPaidInvoices === 'function') {
          let minDue = null;
          for (const inv of coraPendings) {
            if (!inv?.dueDate) continue;
            const d = new Date(inv.dueDate);
            if (Number.isNaN(d.getTime())) continue;
            if (!minDue || d.getTime() < minDue.getTime()) minDue = d;
          }

          const floor = new Date();
          floor.setFullYear(floor.getFullYear() - 3);

          const startDate = minDue ? (minDue.getTime() < floor.getTime() ? floor : minDue) : floor;
          const endDate = new Date();

          financeDebugLog(`🧭 [${syncRunId}] CORA bulk range (by dueDate)`, {
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            pendingCoraCount: coraPendings.length
          });

          const paidIds = await coraGateway.getPaidInvoices({
            startDate,
            endDate,
            states: ['PAID'],
            perPage: 100,
            maxPages: 1000
          });

          bulkPaidIdsStr = Array.isArray(paidIds) ? paidIds.map(x => String(x)) : [];

          financeDebugLog(`📦 [${syncRunId}] CORA BULK candidates`, {
            paidIdsCount: bulkPaidIdsStr.length
          });

          if (bulkPaidIdsStr.length > 0) {
            const affectedInvoices = await Invoice.find({
              school_id: schoolId,
              gateway: 'cora',
              status: { $in: ['pending', 'overdue'] },
              external_id: { $in: bulkPaidIdsStr }
            }).select('_id tutor');

            const result = await Invoice.updateMany(
              {
                school_id: schoolId,
                gateway: 'cora',
                status: { $in: ['pending', 'overdue'] },
                external_id: { $in: bulkPaidIdsStr }
              },
              {
                $set: { status: 'paid' }
              }
            );

            financeDebugLog(`📦 [${syncRunId}] CORA BULK updateMany`, {
              matchedCount: result.matchedCount,
              modifiedCount: result.modifiedCount
            });

            if (result.modifiedCount > 0) {
              stats.updatedCount += result.modifiedCount;

              for (const inv of affectedInvoices) {
                if (inv.tutor) tutorsToRecalculate.add(String(inv.tutor));
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`❌ [${syncRunId}] Erro no Sync CORA (bulk):`, e.message);
    }

    // --- MP TOKEN ---
    let mpToken = null;
    try {
      const selectString = '+mercadoPagoConfig.prodAccessToken';
      const schoolMp = await School.findById(schoolId).select(selectString).lean();
      mpToken = schoolMp?.mercadoPagoConfig?.prodAccessToken || null;
    } catch (e) {
      console.error(`❌ [${syncRunId}] Erro lendo token MP:`, e.message);
    }

    // --- FALLBACK INDIVIDUAL ---
    const MAX_INDIVIDUAL_CHECKS = 250;
    const toCheck = pendingInvoices.slice(0, MAX_INDIVIDUAL_CHECKS);

    await this._runLimitedConcurrency(toCheck, 5, async (inv) => {
      try {
        if (!inv.external_id) return;

        if (inv.gateway === 'mercadopago' && mpToken) {
          const res = await axios.get(`https://api.mercadopago.com/v1/payments/${inv.external_id}`, {
            headers: { Authorization: `Bearer ${mpToken}` },
            timeout: 20000
          });

          const status = res.data?.status || null;
          const paidAt = res.data?.date_approved || res.data?.dateApproved || null;

          const result = await this.handlePaymentWebhook(inv.external_id, 'MP-SYNC', status, paidAt);
          if (result.updated) {
            stats.updatedCount++;
            if (result.invoice?.tutor) tutorsToRecalculate.add(String(result.invoice.tutor));
          }
          return;
        }

        if (inv.gateway === 'cora' && coraGateway) {
          const info = await coraGateway.getInvoicePaymentInfo(inv.external_id);
          const boletoPatch = this._buildGatewayBankSlipPatch(inv, info);

          financeDebugLog(`🔎 [${syncRunId}] CORA status check`, {
            invoiceId: String(inv._id),
            external_id: String(inv.external_id),
            statusFromCora: info?.status,
            paidAtFromCora: info?.paidAt || null,
            boletoPatch
          });

          if (Object.keys(boletoPatch).length > 0) {
            const patchResult = await Invoice.updateOne(
              { _id: inv._id, school_id: schoolId, gateway: 'cora' },
              { $set: boletoPatch }
            );

            if (patchResult.modifiedCount > 0) {
              stats.updatedCount += 1;
            }
          }

          if (info?.status) {
            const result = await this.handlePaymentWebhook(inv.external_id, 'CORA-SYNC', info.status, info.paidAt);
            if (result.updated) {
              stats.updatedCount++;
              if (result.invoice?.tutor) tutorsToRecalculate.add(String(result.invoice.tutor));
            }
          }

          return;
        }
      } catch (e) {
        console.warn(`⚠️ [${syncRunId}] erro check individual`, {
          invoiceId: String(inv._id),
          gateway: inv.gateway,
          external_id: String(inv.external_id),
          message: e.message
        });
      }
    });

    // Post-bulk backfill: keep the 250-item status fallback intact, but repair
    // paidAt for every Cora invoice that the bulk sync marked as paid.
    if (bulkPaidIdsStr.length > 0 && coraGateway && typeof coraGateway.getInvoicePaymentInfo === 'function') {
      const backfillStartedAt = Date.now();
      const backfillMissingFilter = {
        school_id: schoolId,
        gateway: 'cora',
        external_id: { $in: bulkPaidIdsStr },
        status: 'paid',
        $or: [
          { paidAt: { $exists: false } },
          { paidAt: null }
        ]
      };

      let backfillFilledCount = 0;
      let backfillFailedCount = 0;

      try {
        const backfillCandidates = await Invoice.find(backfillMissingFilter)
          .select('_id tutor external_id paidAt')
          .lean();

        financeDebugLog(`🧩 [${syncRunId}] CORA paidAt backfill iniciado`, {
          candidateCount: backfillCandidates.length,
          bulkCandidateCount: bulkPaidIdsStr.length,
          concurrencyLimit: 5
        });

        await this._runLimitedConcurrency(backfillCandidates, 5, async (candidate) => {
          try {
            if (!candidate?.external_id) return;

            const info = await coraGateway.getInvoicePaymentInfo(candidate.external_id);
            const providerPaidAt = this._parseProviderDateValue(info?.paidAt);

            if (!providerPaidAt) {
              return;
            }

            const updateResult = await Invoice.updateOne(
              {
                _id: candidate._id,
                school_id: schoolId,
                gateway: 'cora',
                external_id: String(candidate.external_id),
                status: 'paid',
                $or: [
                  { paidAt: { $exists: false } },
                  { paidAt: null }
                ]
              },
              {
                $set: { paidAt: providerPaidAt }
              }
            );

            if (updateResult.modifiedCount > 0) {
              backfillFilledCount += 1;
              stats.updatedCount += 1;

              if (candidate.tutor) {
                tutorsToRecalculate.add(String(candidate.tutor));
              }
            }
          } catch (backfillError) {
            backfillFailedCount += 1;
            console.warn(`⚠️ [${syncRunId}] erro no backfill CORA paidAt`, {
              invoiceId: String(candidate?._id || ''),
              external_id: String(candidate?.external_id || ''),
              message: backfillError.message
            });
          }
        });

        const backfillRemainingCount = await Invoice.countDocuments(backfillMissingFilter);

        financeDebugLog(`📦 [${syncRunId}] CORA paidAt backfill finalizado`, {
          enteredCount: backfillCandidates.length,
          filledCount: backfillFilledCount,
          remainingWithoutPaidAt: backfillRemainingCount,
          failedCount: backfillFailedCount,
          durationMs: Date.now() - backfillStartedAt
        });
      } catch (backfillError) {
        console.error(`❌ [${syncRunId}] Erro no backfill CORA paidAt`, {
          message: backfillError.message,
          durationMs: Date.now() - backfillStartedAt
        });
      }
    }

    if (tutorsToRecalculate.size > 0) {
      try {
        await tutorFinancialScoreService.recalculateTutorsByIds([...tutorsToRecalculate], schoolId);
      } catch (scoreError) {
        console.error(`⚠️ [${syncRunId}] erro ao recalcular scores após sync:`, scoreError.message);
      }
    }

      if (stats.updatedCount > 0) {
        financeRuntime.invalidateSchool(schoolId);
        NotificationService.invalidateForecastCache({ schoolId });
      }

      if (options.reason !== 'cron_sweep' || stats.updatedCount > 0 || FINANCE_VERBOSE_LOGS) {
        console.log('[FinanceSync] Sync finalizado', {
          runId: syncRunId,
          schoolId: String(schoolId),
          reason: options.reason || 'finance_sync',
          totalChecked: stats.totalChecked,
          updatedCount: stats.updatedCount,
          durationMs: Date.now() - startedAt
        });
      }

      return stats;
    } catch (error) {
      syncError = error;
      console.error(`❌ [${syncRunId}] Sync falhou`, {
        message: error.message,
        durationMs: Date.now() - startedAt
      });
      throw error;
    } finally {
      financeRuntime.finishSync(schoolId, {
        success: !syncError,
        error: syncError,
        updatedCount: stats.updatedCount,
        durationMs: Date.now() - startedAt
      });
    }
  }

    async getAllInvoices(filters = {}, schoolId) {
      const cachePayload = this._normalizeInvoiceCachePayload(filters);
      const cached = financeRuntime.getCache('invoice:list', schoolId, cachePayload);

      if (cached && !cached.stale) {
        return cached.value;
      }

      const query = { school_id: schoolId };
      if (filters.status) query.status = filters.status;

      const invoices = await Invoice.find(query)
        .sort({ dueDate: -1 })
        .populate('student', 'fullName')
        .populate('tutor', 'fullName financialScore')
        .lean();

      financeRuntime.setCache('invoice:list', schoolId, cachePayload, invoices);

      return invoices;
    }

    async getInvoiceById(invoiceId, schoolId) {
      const cachePayload = this._normalizeInvoiceCachePayload({ invoiceId });
      const cached = financeRuntime.getCache('invoice:by-id', schoolId, cachePayload);

      if (cached && !cached.stale) {
        return cached.value;
      }

      const invoice = await Invoice.findOne({ _id: invoiceId, school_id: schoolId })
        .populate('student', 'fullName profilePicture')
        .populate('tutor', 'fullName financialScore')
        .lean();

      if (invoice) {
        financeRuntime.setCache('invoice:by-id', schoolId, cachePayload, invoice);
      }

      return invoice;
    }

  async getInvoicesByStudent(studentId, schoolId) {
      const cachePayload = this._normalizeInvoiceCachePayload({ studentId });
      const cached = financeRuntime.getCache('invoice:by-student', schoolId, cachePayload);

      if (cached && !cached.stale) {
        return cached.value;
      }

      const invoices = await Invoice.find({ student: studentId, school_id: schoolId })
        .sort({ dueDate: -1 })
        .populate('tutor', 'fullName financialScore')
        .lean();

      financeRuntime.setCache('invoice:by-student', schoolId, cachePayload, invoices);

      return invoices;
    }

  async processFinanceSyncSweep() {
    const schoolIds = await Invoice.distinct('school_id', {
      status: { $in: ['pending', 'overdue'] },
      gateway: { $in: ['mercadopago', 'cora'] },
      external_id: { $exists: true, $ne: null },
    });

    const stats = {
      totalSchools: schoolIds.length,
      startedSchools: 0,
      skippedSchools: 0,
      failedSchools: 0,
      updatedCount: 0,
      perSchool: [],
    };

    for (const schoolId of schoolIds) {
      try {
        const result = await this.syncPendingInvoices(null, schoolId, null, {
          reason: 'cron_sweep',
          force: false,
        });

        if (result?.skipped) {
          stats.skippedSchools++;
        } else {
          stats.startedSchools++;
          stats.updatedCount += result?.updatedCount || 0;
        }

        stats.perSchool.push({
          schoolId: String(schoolId),
          skipped: !!result?.skipped,
          updatedCount: result?.updatedCount || 0,
          reason: result?.reason || null,
        });
      } catch (error) {
        stats.failedSchools++;
        stats.perSchool.push({
          schoolId: String(schoolId),
          skipped: false,
          error: error.message,
        });
      }
    }

    return stats;
  }

  async findOverdue(schoolId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Invoice.find({
      school_id: schoolId,
      dueDate: { $lt: today },
      status: { $nin: ['paid', 'canceled'] }
    }).select('description value dueDate student tutor')
      .populate('student', 'fullName')
      .populate('tutor', 'fullName financialScore')
      .lean();
  }

  async debugCoraInvoice(externalId, schoolId) {
    const debugRunId = `cora-debug-${schoolId}-${Date.now()}`;
    const startedAt = Date.now();

    if (!externalId) throw new Error('externalId é obrigatório');

    const local = await Invoice.findOne({
      school_id: schoolId,
      external_id: String(externalId)
    })
      .select('_id status paidAt dueDate gateway external_id createdAt updatedAt tutor')
      .lean();

    const selectString = [
      'coraConfig.isSandbox',
      'coraConfig.sandbox.clientId',
      '+coraConfig.sandbox.certificateContent',
      '+coraConfig.sandbox.privateKeyContent',
      'coraConfig.production.clientId',
      '+coraConfig.production.certificateContent',
      '+coraConfig.production.privateKeyContent',
      'name'
    ].join(' ');

    const school = await School.findById(schoolId).select(selectString).lean();
    if (!school) throw new Error('Escola não encontrada');

    const coraGateway = await GatewayFactory.create(school, 'CORA');

    try {
      const paymentInfo = await coraGateway.getInvoicePaymentInfo(String(externalId));

      return {
        ok: true,
        debugRunId,
        externalId: String(externalId),
        environment: school?.coraConfig?.isSandbox ? 'sandbox' : 'production',
        localInvoice: local || null,
        cora: paymentInfo,
        durationMs: Date.now() - startedAt
      };
    } catch (e) {
      return {
        ok: false,
        debugRunId,
        externalId: String(externalId),
        environment: school?.coraConfig?.isSandbox ? 'sandbox' : 'production',
        localInvoice: local || null,
        durationMs: Date.now() - startedAt,
        error: {
          message: e.message,
          name: e.name,
          stack: e.stack
        }
      };
    }
  }
}

module.exports = new InvoiceService();
