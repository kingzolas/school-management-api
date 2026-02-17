// src/api/services/invoice.service.js
const Invoice = require('../models/invoice.model.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const School = require('../models/school.model.js');
const whatsappService = require('./whatsapp.service.js');
const NotificationService = require('./notification.service.js');
const GatewayFactory = require('../gateways/gateway.factory.js');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const https = require('https');
const { PDFDocument } = require('pdf-lib');

class InvoiceService {

  /**
   * Cria fatura (Mercado Pago ou Cora) e enfileira a notificação SE for elegível
   */
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

    const gateway = GatewayFactory.create(school, chosenGateway);

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
        boleto_barcode: result.boleto_barcode,
        pix_code: result.pix_code,
        pix_qr_base64: result.pix_qr_base64,
        mp_payment_id: result.gateway === 'mercadopago' ? result.external_id : undefined,
        mp_pix_copia_e_cola: result.pix_code,
        mp_ticket_url: result.boleto_url
      });

      await newInvoice.save();
      console.log('[InvoiceService] ✅ Invoice salva no DB:', {
        invoiceId: String(newInvoice._id),
        gateway: newInvoice.gateway,
        external_id: String(newInvoice.external_id)
      });

      if (payerPhone) {
        try {
          const isAutoEligible = NotificationService.isEligibleForSending(newInvoice.dueDate);
          const shouldSendNow = isAutoEligible || (sendNow === true);

          console.log('[InvoiceService] Notificação elegível?', {
            isAutoEligible,
            sendNow: sendNow === true,
            shouldSendNow
          });

          if (shouldSendNow) {
            await NotificationService.queueNotification({
              schoolId: schoolId,
              invoiceId: newInvoice._id,
              studentName: student.fullName,
              tutorName: payerName,
              phone: payerPhone,
              type: 'new_invoice'
            });
            console.log('[InvoiceService] ✅ Notificação enfileirada:', {
              invoiceId: String(newInvoice._id),
              phone: payerPhone
            });
          }
        } catch (queueError) {
          console.error('⚠️ [InvoiceService] Erro ao tentar enfileirar (não bloqueante):', queueError.message);
        }
      }

      return await this.getInvoiceById(newInvoice._id, schoolId);

    } catch (error) {
      console.error('❌ [InvoiceService] ERRO Create Invoice (Raw):', error.message);
      const friendlyError = this._translateGatewayError(error, payerName);
      throw new Error(friendlyError);
    }
  }

  _translateGatewayError(error, payerName = 'o responsável') {
    let errorData = null;

    if (error.response && error.response.data) {
      errorData = error.response.data;
    } else {
      try {
        const match = error.message.match(/\{.*\}/);
        if (match) {
          errorData = JSON.parse(match[0]);
        }
      } catch (e) { /* Falha silenciosa */ }
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

  async resendNotification(invoiceId, schoolId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, school_id: schoolId })
      .populate('student').populate('tutor');

    if (!invoice) throw new Error('Fatura não encontrada.');

    let targetName, targetPhone;
    if (invoice.tutor) {
      targetName = invoice.tutor.fullName;
      targetPhone = invoice.tutor.phoneNumber || invoice.tutor.telefone || invoice.tutor.celular;
    } else if (invoice.student) {
      targetName = invoice.student.fullName;
      targetPhone = invoice.student.phoneNumber || invoice.student.telefone || invoice.student.celular;
    }

    if (!targetPhone) throw new Error('Responsável financeiro não possui telefone cadastrado.');

    try {
      await NotificationService.queueNotification({
        schoolId: schoolId,
        invoiceId: invoice._id,
        studentName: invoice.student.fullName,
        tutorName: targetName,
        phone: targetPhone,
        type: 'reminder'
      });
      return true;
    } catch (e) {
      throw new Error("Erro ao agendar envio: " + e.message);
    }
  }

  async processDailyReminders() {
    console.log('⚠️ [InvoiceService] processDailyReminders chamado (Legado). Use NotificationService.');
  }

  async cancelInvoice(invoiceId, schoolId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, school_id: schoolId });
    if (!invoice) throw new Error('Fatura não encontrada');
    if (invoice.status === 'paid') throw new Error('Fatura já PAGA não pode ser cancelada.');

    const school = await School.findById(schoolId).lean();
    const gatewayName = invoice.gateway === 'cora' ? 'CORA' : 'MERCADOPAGO';

    try {
      const gateway = GatewayFactory.create(school, gatewayName);
      if (invoice.external_id) {
        await gateway.cancelInvoice(invoice.external_id);
      }
    } catch (error) {
      console.warn(`Erro ao cancelar no gateway (${gatewayName}):`, error.message);
    }

    invoice.status = 'canceled';
    await invoice.save();
    return invoice;
  }

  /**
   * ✅ Agora resolve o caso MP quando statusRaw=null, buscando status na API do MP.
   * E melhora logs pra você rastrear o caminho.
   */
  async handlePaymentWebhook(externalId, providerName, statusRaw) {
    const hookRunId = `${providerName || 'PROVIDER'}-${Date.now()}`;

    console.log(`\n🔔 [handlePaymentWebhook ${hookRunId}] chamado`, {
      externalId: String(externalId),
      providerName,
      statusRaw: statusRaw ?? null
    });

    let invoice = await Invoice.findOne({
      $or: [{ external_id: externalId }, { mp_payment_id: externalId }]
    });

    if (!invoice) {
      console.warn(`⚠️ [handlePaymentWebhook ${hookRunId}] invoice não encontrada no DB`, { externalId: String(externalId) });
      return { processed: false, updated: false, reason: 'not_found' };
    }

    // ✅ Se for MP e não veio status, busca na API do MP
    if ((!statusRaw || statusRaw === null) && String(providerName).toUpperCase().includes('MERCADO_PAGO')) {
      try {
        console.log(`🔎 [handlePaymentWebhook ${hookRunId}] statusRaw vazio no MP, buscando status na API...`, {
          invoiceId: String(invoice._id),
          external_id: String(invoice.external_id)
        });

        const school = await School.findById(invoice.school_id).select('+mercadoPagoConfig.prodAccessToken').lean();
        const mpToken = school?.mercadoPagoConfig?.prodAccessToken;

        if (!mpToken) {
          console.warn(`⚠️ [handlePaymentWebhook ${hookRunId}] MP token ausente na escola`, { schoolId: String(invoice.school_id) });
        } else {
          const res = await axios.get(`https://api.mercadopago.com/v1/payments/${externalId}`, {
            headers: { Authorization: `Bearer ${mpToken}` },
            timeout: 20000
          });
          statusRaw = res.data?.status || null;

          console.log(`📌 [handlePaymentWebhook ${hookRunId}] status MP obtido`, {
            statusRaw,
            status_detail: res.data?.status_detail
          });
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

      if (statusPago.includes(s) || statusPago.includes(sl) || s === 'paid') {
        novoStatus = 'paid';
      } else if (statusCancelado.includes(s) || statusCancelado.includes(sl)) {
        novoStatus = 'canceled';
      }
    } else {
      console.log(`ℹ️ [handlePaymentWebhook ${hookRunId}] statusRaw ainda vazio, mantendo status atual`, {
        invoiceId: String(invoice._id),
        currentStatus: invoice.status
      });
    }

    let wasUpdated = false;

    if (invoice.status !== novoStatus || (novoStatus === 'paid' && !invoice.paidAt)) {
      const oldStatus = invoice.status;

      invoice.status = novoStatus;
      if (novoStatus === 'paid' && !invoice.paidAt) {
        invoice.paidAt = new Date();
      }

      await invoice.save();
      console.log(`✅ [DB UPDATE ${hookRunId}] Fatura ${invoice._id} atualizada`, {
        oldStatus,
        newStatus: novoStatus,
        paidAt: invoice.paidAt || null,
        providerName
      });

      wasUpdated = true;
    } else {
      console.log(`🟡 [handlePaymentWebhook ${hookRunId}] Nenhuma alteração necessária`, {
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

  /**
   * ✅ Sync com LOGS + CORA bulk + CORA fallback individual + MP sync
   */
  async syncPendingInvoices(studentId, schoolId, singleInvoiceId = null) {
    const syncRunId = `sync-${schoolId}-${Date.now()}`;
    const startedAt = Date.now();

    const filter = {
      school_id: schoolId,
      status: 'pending',
      gateway: { $in: ['mercadopago', 'cora'] },
      external_id: { $exists: true, $ne: null }
    };

    if (studentId) filter.student = studentId;
    if (singleInvoiceId) filter._id = singleInvoiceId;

    console.log(`\n🔄 [${syncRunId}] Iniciando syncPendingInvoices`, {
      schoolId,
      studentId: studentId || null,
      singleInvoiceId: singleInvoiceId || null
    });

    const pendingInvoices = await Invoice.find(filter).lean();
    const stats = { totalChecked: pendingInvoices.length, updatedCount: 0, details: [] };

    const coraPendings = pendingInvoices.filter(i => i.gateway === 'cora');
    const mpPendings = pendingInvoices.filter(i => i.gateway === 'mercadopago');

    console.log(`📌 [${syncRunId}] Pendentes no DB`, {
      total: pendingInvoices.length,
      cora: coraPendings.length,
      mercadopago: mpPendings.length
    });

    // --- CORA BULK ---
    let coraGateway = null;
    try {
      const school = await School.findById(schoolId).lean();

      const hasCora =
        !!(school?.coraConfig?.production?.clientId || school?.coraConfig?.sandbox?.clientId);

      console.log(`🏦 [${syncRunId}] Cora config detectada?`, {
        hasCora,
        isSandbox: school?.coraConfig?.isSandbox ?? null
      });

      if (hasCora) {
        coraGateway = GatewayFactory.create(school, 'CORA');

        console.log(`🧩 [${syncRunId}] CORA gateway criado`, {
          hasGetPaidInvoices: typeof coraGateway.getPaidInvoices === 'function',
          hasGetInvoiceStatus: typeof coraGateway.getInvoiceStatus === 'function',
          hasGetInvoice: typeof coraGateway.getInvoice === 'function'
        });

        if (typeof coraGateway.getPaidInvoices === 'function') {
          const paidIds = await coraGateway.getPaidInvoices(60);

          console.log(`📥 [${syncRunId}] CORA getPaidInvoices(60)`, {
            paidIdsCount: Array.isArray(paidIds) ? paidIds.length : null,
            sample: Array.isArray(paidIds) ? paidIds.slice(0, 5) : paidIds
          });

          if (Array.isArray(paidIds) && paidIds.length > 0) {
            // ✅ normaliza para string pra evitar mismatch
            const paidIdsStr = paidIds.map(x => String(x));

            const result = await Invoice.updateMany(
              {
                school_id: schoolId,
                status: { $ne: 'paid' },
                external_id: { $in: paidIdsStr }
              },
              {
                $set: {
                  status: 'paid',
                  paidAt: new Date()
                }
              }
            );

            console.log(`📦 [${syncRunId}] CORA BULK updateMany`, {
              matchedCount: result.matchedCount,
              modifiedCount: result.modifiedCount
            });

            if (result.modifiedCount > 0) {
              stats.updatedCount += result.modifiedCount;
            }
          } else {
            console.log(`ℹ️ [${syncRunId}] CORA bulk retornou 0 paidIds`);
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

      console.log(`💳 [${syncRunId}] MP token presente?`, { hasMpToken: !!mpToken });
    } catch (e) {
      console.error(`❌ [${syncRunId}] Erro lendo token MP:`, e.message);
    }

    // --- FALLBACK INDIVIDUAL (MP + CORA) ---
    // ✅ limitador de chamadas individuais
    const MAX_INDIVIDUAL_CHECKS = 80;
    const toCheck = pendingInvoices.slice(0, MAX_INDIVIDUAL_CHECKS);

    await Promise.all(toCheck.map(async (inv) => {
      try {
        if (!inv.external_id) return;

        // MP
        if (inv.gateway === 'mercadopago' && mpToken) {
          const res = await axios.get(`https://api.mercadopago.com/v1/payments/${inv.external_id}`, {
            headers: { Authorization: `Bearer ${mpToken}` },
            timeout: 20000
          });

          const result = await this.handlePaymentWebhook(inv.external_id, 'MP-SYNC', res.data?.status);
          if (result.updated) stats.updatedCount++;
          return;
        }

        // ✅ CORA fallback individual
        if (inv.gateway === 'cora' && coraGateway) {
          let statusFromCora = null;

          if (typeof coraGateway.getInvoiceStatus === 'function') {
            statusFromCora = await coraGateway.getInvoiceStatus(inv.external_id);
          }

          console.log(`🔎 [${syncRunId}] CORA status check`, {
            invoiceId: String(inv._id),
            external_id: String(inv.external_id),
            statusFromCora
          });

          if (statusFromCora) {
            const result = await this.handlePaymentWebhook(inv.external_id, 'CORA-SYNC', statusFromCora);
            if (result.updated) stats.updatedCount++;
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
    }));

    console.log(`✅ [${syncRunId}] Sync finalizado`, {
      totalChecked: stats.totalChecked,
      updatedCount: stats.updatedCount,
      durationMs: Date.now() - startedAt
    });

    return stats;
  }

  async getAllInvoices(filters = {}, schoolId) {
    // ✅ não engole erro silenciosamente: loga se falhar
    this.syncPendingInvoices(null, schoolId).catch((e) => {
      console.error('❌ [InvoiceService] syncPendingInvoices falhou em getAllInvoices:', e.message);
    });

    const query = { school_id: schoolId };
    if (filters.status) query.status = filters.status;

    return Invoice.find(query)
      .sort({ dueDate: -1 })
      .populate('student', 'fullName')
      .populate('tutor', 'fullName');
  }

  async getInvoiceById(invoiceId, schoolId) {
    try {
      await this.syncPendingInvoices(null, schoolId, invoiceId);
    } catch (e) {
      console.error('⚠️ [InvoiceService] syncPendingInvoices falhou em getInvoiceById:', e.message);
    }

    return Invoice.findOne({ _id: invoiceId, school_id: schoolId })
      .populate('student', 'fullName profilePicture')
      .populate('tutor', 'fullName');
  }

  async getInvoicesByStudent(studentId, schoolId) {
    try {
      await this.syncPendingInvoices(studentId, schoolId);
    } catch (e) {
      console.error('⚠️ [InvoiceService] syncPendingInvoices falhou em getInvoicesByStudent:', e.message);
    }

    return Invoice.find({ student: studentId, school_id: schoolId })
      .sort({ dueDate: -1 })
      .populate('tutor', 'fullName');
  }

  async findOverdue(schoolId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Invoice.find({
      school_id: schoolId,
      dueDate: { $lt: today },
      status: { $nin: ['paid', 'canceled'] }
    }).select('description value dueDate student')
      .populate('student', 'fullName')
      .lean();
  }
}

module.exports = new InvoiceService();
