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

    // 1. Busca configurações
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

    // 2. Validações de Aluno
    const student = await Student.findOne({ _id: studentId, school_id: schoolId })
        .populate('financialTutorId');

    if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

    // 3. Limpeza Endereço
    const rawAddr = student.address || {};
    let cleanZip = (rawAddr.zipCode || rawAddr.cep || '').replace(/\D/g, '');
    if (cleanZip.length !== 8) cleanZip = '01310100'; // Fallback

    const cleanAddress = {
        street: rawAddr.street || 'Rua não informada',
        number: rawAddr.number || '0',
        district: rawAddr.neighborhood || rawAddr.district || 'Bairro',
        city: rawAddr.city || 'São Paulo',
        state: (rawAddr.state && rawAddr.state.length === 2) ? rawAddr.state : 'SP',
        zip_code: cleanZip 
    };

    // 4. Pagador
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

    // 5. Gateway e Payload
    const gateway = GatewayFactory.create(school, chosenGateway);
    // Garante que o email não tenha espaços vazios
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
      console.log(`[InvoiceService] Gerando cobrança via ${gateway.constructor.name}...`);
      
      const result = await gateway.createInvoice(paymentPayload);

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

      // ==================================================================================
      // 🛡️ AUTOMAÇÃO
      // ==================================================================================
      if (payerPhone) {
          try {
              const isAutoEligible = NotificationService.isEligibleForSending(newInvoice.dueDate);
              const shouldSendNow = isAutoEligible || (sendNow === true);

              if (shouldSendNow) {
                  await NotificationService.queueNotification({
                      schoolId: schoolId,
                      invoiceId: newInvoice._id,
                      studentName: student.fullName,
                      tutorName: payerName,
                      phone: payerPhone,
                      type: 'new_invoice' 
                  });
              }
          } catch (queueError) {
              console.error('⚠️ Erro ao tentar enfileirar (não bloqueante):', queueError.message);
          }
      }

      return await this.getInvoiceById(newInvoice._id, schoolId);

    } catch (error) {
      console.error('❌ ERRO Create Invoice (Raw):', error.message);
      
      // Chamada da função de tradução robusta
      const friendlyError = this._translateGatewayError(error, payerName);
      
      // Lança o erro limpo para o Controller devolver ao Front
      throw new Error(friendlyError);
    }
  }

  /**
   * Tradutor de Erros Avançado (Baseado no seu código antigo + correções atuais)
   */
  _translateGatewayError(error, payerName = 'o responsável') {
    let errorData = null;

    // 1. Tenta pegar o erro estruturado do Axios (Response)
    if (error.response && error.response.data) {
        errorData = error.response.data;
    } 
    // 2. Se não tiver response, tenta ver se a mensagem de erro é um JSON (O caso do Log que você mandou)
    else {
        try {
            // Procura por JSON dentro da string de erro (ex: "Erro Cora: {...}")
            const match = error.message.match(/\{.*\}/);
            if (match) {
                errorData = JSON.parse(match[0]);
            }
        } catch (e) { /* Falha silenciosa no parse */ }
    }

    // --- TRATAMENTO ESTRUTURADO (Se conseguimos extrair um objeto de erro) ---
    if (errorData && errorData.errors && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
        const err = errorData.errors[0];
        const code = (err.code || '').toLowerCase();
        const msg = (err.message || '').toLowerCase();

        // [SEU CÓDIGO ANTIGO] Mapeamento de erros comuns da Cora
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
        
        // Retorno genérico do banco (fallback)
        return `Erro no Banco Cora: ${err.message}`;
    }

    // --- TRATAMENTO DE TEXTO BRUTO (Última linha de defesa) ---
    // Caso o erro venha como string simples sem JSON
    const errorString = (error.message || '').toLowerCase();

    if (errorString.includes('customer.email')) return `E-mail do responsável (${payerName}) inválido.`;
    if (errorString.includes('customer.document')) return `CPF do responsável (${payerName}) inválido.`;
    if (errorString.includes('socket hang up') || errorString.includes('econneused')) return 'Erro de conexão com o banco. Tente novamente.';

    // Se nada funcionar, retorna a mensagem original (tentando limpar prefixos técnicos)
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

  // Mantido para compatibilidade com seu código antigo
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

  async handlePaymentWebhook(externalId, providerName, statusRaw) {
    let invoice = await Invoice.findOne({ 
        $or: [ { external_id: externalId }, { mp_payment_id: externalId } ]
    });
    if (!invoice) return { processed: false, updated: false, reason: 'not_found' };

    let novoStatus = invoice.status;
    const statusPago = ['approved', 'paid', 'COMPLETED', 'LIQUIDATED', 'PAID'];
    const statusCancelado = ['cancelled', 'rejected', 'CANCELED', 'canceled', 'CANCELLED'];

    if (statusRaw) {
        if (statusPago.includes(statusRaw) || statusPago.includes(statusRaw.toLowerCase())) {
            novoStatus = 'paid';
        } else if (statusCancelado.includes(statusRaw) || statusCancelado.includes(statusRaw.toLowerCase())) {
            novoStatus = 'canceled';
        }
    }

    let wasUpdated = false;
    if (invoice.status !== novoStatus) {
      invoice.status = novoStatus;
      if (novoStatus === 'paid' && !invoice.paidAt) invoice.paidAt = new Date();
      await invoice.save();
      console.log(`✅ [DB UPDATE] Fatura ${invoice._id} SALVA como ${novoStatus} (Origem: ${providerName})`);
      wasUpdated = true;
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

  // [SINCRONIZAÇÃO] - Voltando para o modelo do seu código antigo que retorna stats
  async syncPendingInvoices(studentId, schoolId, singleInvoiceId = null) {
    const filter = {
        school_id: schoolId,
        status: 'pending',
        gateway: 'mercadopago', // MP precisa de sync manual
        external_id: { $exists: true }
    };

    if (studentId) filter.student = studentId;
    if (singleInvoiceId) filter._id = singleInvoiceId;

    const pendingInvoices = await Invoice.find(filter);
    
    // CORA: Implementação do Sync em Massa (Se disponível na config)
    // Mantive isso pois é muito mais performático que um por um
    try {
        const school = await School.findById(schoolId).lean();
        if (school.coraConfig?.production?.clientId || school.coraConfig?.sandbox?.clientId) {
             const gateway = GatewayFactory.create(school, 'CORA');
             if (typeof gateway.getPaidInvoices === 'function') {
                const paidIds = await gateway.getPaidInvoices(30);
                if (paidIds.length > 0) {
                     await Invoice.updateMany(
                        { school_id: schoolId, status: { $ne: 'paid' }, external_id: { $in: paidIds } },
                        { $set: { status: 'paid', paidAt: new Date() } }
                    );
                    console.log(`📦 [CORA BULK] ${paidIds.length} faturas atualizadas.`);
                }
             }
        }
    } catch(e) { console.error("Erro no Sync Cora:", e.message); }

    // MERCADO PAGO: Validação individual (igual ao seu código legado)
    const stats = { totalChecked: pendingInvoices.length, updatedCount: 0, details: [] };
    const selectString = '+mercadoPagoConfig.prodAccessToken';
    const school = await School.findById(schoolId).select(selectString).lean();

    if (school && school.mercadoPagoConfig?.prodAccessToken) {
        const mpToken = school.mercadoPagoConfig.prodAccessToken;
        await Promise.all(pendingInvoices.map(async (inv) => {
            try {
                const res = await axios.get(`https://api.mercadopago.com/v1/payments/${inv.external_id}`, { 
                    headers: { 'Authorization': `Bearer ${mpToken}` } 
                });
                const result = await this.handlePaymentWebhook(inv.external_id, 'MP-SYNC', res.data.status);
                if (result.updated) stats.updatedCount++;
            } catch (e) { /* ignore */ }
        }));
    }

    return stats;
  }

  async getAllInvoices(filters = {}, schoolId) {
    // Sync em background
    this.syncPendingInvoices(null, schoolId).catch(() => {});
     
    const query = { school_id: schoolId }; 
    if (filters.status) query.status = filters.status;
    return Invoice.find(query).sort({ dueDate: -1 }).populate('student', 'fullName').populate('tutor', 'fullName');
  }

  async getInvoiceById(invoiceId, schoolId) {
    try { await this.syncPendingInvoices(null, schoolId, invoiceId); } catch (e) {}
    return Invoice.findOne({ _id: invoiceId, school_id: schoolId }).populate('student', 'fullName profilePicture').populate('tutor', 'fullName');
  }

  async getInvoicesByStudent(studentId, schoolId) {
    try { await this.syncPendingInvoices(studentId, schoolId); } catch (e) {}
    return Invoice.find({ student: studentId, school_id: schoolId }).sort({ dueDate: -1 }).populate('tutor', 'fullName');
  }
   
  async findOverdue(schoolId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Invoice.find({
      school_id: schoolId, 
      dueDate: { $lt: today },
      status: { $nin: ['paid', 'canceled'] }
    }).select('description value dueDate student').populate('student', 'fullName').lean();
  }
}

module.exports = new InvoiceService();