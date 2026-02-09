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
     
    if (cleanZip.length !== 8) {
        cleanZip = '01310100'; // Fallback
    }

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
    const finalEmail = (payerEmail && payerEmail.includes('@')) 
        ? payerEmail 
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

      // Automação
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
      const friendlyError = this._translateGatewayError(error);
      throw new Error(friendlyError);
    }
  }

  _translateGatewayError(error) {
    if (error.response && error.response.data) {
        const data = error.response.data;
        if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
            const err = data.errors[0];
            const code = err.code || '';
            const msg = (err.message || '').toLowerCase();

            if (code === 'customer.email' || msg.includes('not a valid email')) return 'O e-mail do Responsável Financeiro é inválido.';
            if (code === 'customer.document' || msg.includes('cpf')) return 'O CPF/CNPJ do Responsável Financeiro é inválido.';
            if (code === 'customer.name') return 'O nome do Responsável Financeiro é inválido ou muito curto.';
            if (code === 'services.amount') return 'O valor da cobrança é inválido.';
            if (code === 'payment_options.due_date') return 'A data de vencimento é inválida ou já passou.';
            
            return `Erro no Banco Cora: ${err.message}`;
        }
        if (data.message) {
            if (data.message.includes('Request has invalid parameters')) return 'Dados inválidos enviados para o banco.';
            return `O Banco recusou: ${data.message}`;
        }
    }
    const msg = error.message || '';
    if (msg.includes('customer.email')) return 'E-mail do responsável inválido.';
    return msg;
  }

  async resendNotification(invoiceId, schoolId) {
    // ... (Código de reenvio mantido igual)
    const invoice = await Invoice.findOne({ _id: invoiceId, school_id: schoolId })
        .populate('student').populate('tutor');

    if (!invoice) throw new Error('Fatura não encontrada.');
    
    // ... Logica de pegar telefone ...
    let targetName, targetPhone;
    if (invoice.tutor) {
        targetName = invoice.tutor.fullName;
        targetPhone = invoice.tutor.phoneNumber || invoice.tutor.telefone || invoice.tutor.celular;
    } else if (invoice.student) {
        targetName = invoice.student.fullName;
        targetPhone = invoice.student.phoneNumber || invoice.student.telefone || invoice.student.celular;
    }

    if (!targetPhone) throw new Error('Responsável financeiro sem telefone.');

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
      console.log('⚠️ [InvoiceService] processDailyReminders chamado (Legado).');
  }

  async cancelInvoice(invoiceId, schoolId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, school_id: schoolId });
    if (!invoice) throw new Error('Fatura não encontrada');
    if (invoice.status === 'paid') throw new Error('Fatura já PAGA não pode ser cancelada.');
     
    const school = await School.findById(schoolId).lean();
    const gatewayName = invoice.gateway === 'cora' ? 'CORA' : 'MERCADOPAGO';
     
    try {
        const gateway = GatewayFactory.create(school, gatewayName);
        if (invoice.external_id) await gateway.cancelInvoice(invoice.external_id);
    } catch (error) {
        console.warn(`Erro ao cancelar no gateway (${gatewayName}):`, error.message);
    }

    invoice.status = 'canceled';
    await invoice.save();
    return invoice;
  }

  async handlePaymentWebhook(externalId, providerName, statusRaw) {
    console.log(`🔎 [WEBHOOK/SYNC] Processando status para ID: ${externalId} | Status: ${statusRaw} | Prov: ${providerName}`);
    
    let invoice = await Invoice.findOne({ 
        $or: [ { external_id: externalId }, { mp_payment_id: externalId } ]
    });
    
    if (!invoice) {
        console.error(`❌ [WEBHOOK/SYNC] Fatura não encontrada no DB para o ID ${externalId}`);
        return { processed: false, updated: false, reason: 'not_found' };
    }

    let novoStatus = invoice.status;
    const statusPago = ['approved', 'paid', 'COMPLETED', 'LIQUIDATED', 'PAID'];
    const statusCancelado = ['cancelled', 'rejected', 'CANCELED', 'canceled', 'CANCELLED'];

    if (statusRaw) {
        if (statusPago.includes(statusRaw) || statusPago.includes(statusRaw.toUpperCase())) {
            novoStatus = 'paid';
        } else if (statusCancelado.includes(statusRaw) || statusCancelado.includes(statusRaw.toUpperCase())) {
            novoStatus = 'canceled';
        }
    }

    let wasUpdated = false;
    if (invoice.status !== novoStatus) {
      console.log(`🔄 [STATUS CHANGE] Fatura ${invoice._id} mudando de ${invoice.status} para ${novoStatus}`);
      invoice.status = novoStatus;
      if (novoStatus === 'paid' && !invoice.paidAt) invoice.paidAt = new Date();
      await invoice.save();
      console.log(`✅ [DB SAVED] Fatura ${invoice._id} salva com sucesso.`);
      wasUpdated = true;
    } else {
        console.log(`ℹ️ [NO CHANGE] Fatura ${invoice._id} já estava com status ${invoice.status}.`);
    }
     
    return { processed: true, updated: wasUpdated, invoice, newStatus: novoStatus };
  }

  async generateBatchPdf(invoiceIds, schoolId) {
    // ... (Mantido código de PDF igual)
    const invoices = await Invoice.find({
        _id: { $in: invoiceIds },
        school_id: schoolId,
        $or: [ { boleto_url: { $exists: true, $ne: null } }, { mp_ticket_url: { $exists: true, $ne: null } } ]
    });

    if (!invoices.length) throw new Error("Nenhuma fatura encontrada.");

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
            console.error(`Erro PDF ${inv._id}:`, error.message);
        }
    }

    if (processedCount === 0) throw new Error("Falha ao processar PDFs.");
    return await mergedPdf.save();
  }

  // =========================================================================================
  // 🔥 MÉTODO COM LOGS DETALHADOS (DEBUG MODE ON)
  // =========================================================================================
  async syncPendingInvoices(studentId, schoolId, singleInvoiceId = null) {
    console.log(`🚀 [SYNC] Iniciando syncPendingInvoices. SchoolID: ${schoolId}`);
    
    const filter = {
        school_id: schoolId,
        status: 'pending',
        gateway: { $in: ['cora', 'mercadopago'] },
        external_id: { $exists: true }
    };
    if (studentId) filter.student = studentId;
    if (singleInvoiceId) filter._id = singleInvoiceId;

    const pendingInvoices = await Invoice.find(filter);
    console.log(`📂 [SYNC] Encontradas ${pendingInvoices.length} faturas pendentes no banco.`);
     
    const stats = { totalChecked: pendingInvoices.length, updatedCount: 0, details: [] };
    if (pendingInvoices.length === 0) return stats;

    const selectString = [
        '+mercadoPagoConfig.prodAccessToken',
        'coraConfig.isSandbox', 
        'coraConfig.sandbox.clientId',
        '+coraConfig.sandbox.certificateContent',
        '+coraConfig.sandbox.privateKeyContent',
        'coraConfig.production.clientId',
        '+coraConfig.production.certificateContent',
        '+coraConfig.production.privateKeyContent'
    ].join(' ');

    const school = await School.findById(schoolId).select(selectString).lean();
    if (!school) {
        console.error(`❌ [SYNC] Escola não encontrada nas configurações. Abortando.`);
        return stats;
    }

    let coraAccessToken = null;

    // Função interna de Auth com LOGS
    const getCoraToken = async () => {
        if (coraAccessToken) return coraAccessToken;
        try {
            console.log(`🔑 [CORA-AUTH] Tentando gerar token...`);
            const isSandbox = school.coraConfig?.isSandbox;
            const config = isSandbox ? school.coraConfig.sandbox : school.coraConfig.production;
            
            if (!config.certificateContent || !config.privateKeyContent) {
                console.error(`❌ [CORA-AUTH] Certificado ou Chave Privada ausentes.`);
                return null;
            }

            const httpsAgent = new https.Agent({
                cert: config.certificateContent,
                key: config.privateKeyContent,
                rejectUnauthorized: false
            });

            const authUrl = isSandbox 
                ? 'https://matls-clients.api.stage.cora.com.br/token'
                : 'https://matls-clients.api.cora.com.br/token';

            const payload = {
                grant_type: 'client_credentials',
                client_id: config.clientId
            };

            const response = await axios.post(authUrl, payload, {
                httpsAgent,
                headers: { 'Content-Type': 'application/json' }
            });

            coraAccessToken = response.data.access_token;
            console.log('✅ [CORA-AUTH] Token gerado com sucesso!');
            return coraAccessToken;
        } catch (e) {
            const data = e.response ? JSON.stringify(e.response.data) : 'Sem dados';
            console.error(`❌ [CORA-AUTH] Falha Crítica: ${e.message} | Dados: ${data}`);
            return null;
        }
    };

    await Promise.all(pendingInvoices.map(async (invoice) => {
        try {
            let result = { updated: false };
            console.log(`👉 [SYNC-ITEM] Verificando Invoice: ${invoice._id} | Gateway: ${invoice.gateway} | ExtID: ${invoice.external_id}`);

            // ----------------------------------------------------
            // 1. MERCADO PAGO
            // ----------------------------------------------------
            if (invoice.gateway === 'mercadopago') {
                const mpToken = school.mercadoPagoConfig?.prodAccessToken;
                if (mpToken) {
                    const res = await axios.get(`https://api.mercadopago.com/v1/payments/${invoice.external_id}`, { headers: { 'Authorization': `Bearer ${mpToken}` } });
                    result = await this.handlePaymentWebhook(invoice.external_id, 'MP-SYNC', res.data.status);
                } else {
                    console.warn(`⚠️ [SYNC-MP] Token MP não configurado.`);
                }
            } 
            // ----------------------------------------------------
            // 2. CORA
            // ----------------------------------------------------
            else if (invoice.gateway === 'cora') {
                const token = await getCoraToken();
                if (token) {
                    const isSandbox = school.coraConfig?.isSandbox;
                    const baseUrl = isSandbox 
                        ? 'https://api.stage.cora.com.br/v2/invoices' 
                        : 'https://api.cora.com.br/v2/invoices';

                    const urlConsulta = `${baseUrl}/${invoice.external_id}`;
                    // console.log(`📡 [CORA-REQ] GET ${urlConsulta}`); // Descomente se quiser ver a URL exata

                    try {
                        const res = await axios.get(urlConsulta, {
                            headers: { 
                                'Authorization': `Bearer ${token}`,
                                'X-API-Key': isSandbox ? school.coraConfig.sandbox.clientId : school.coraConfig.production.clientId
                            }
                        });

                        const statusCora = res.data.status || res.data.state;
                        console.log(`📩 [CORA-RES] Invoice ${invoice.external_id} retornou status: ${statusCora}`);

                        if (statusCora) {
                            result = await this.handlePaymentWebhook(invoice.external_id, 'CORA-SYNC', statusCora);
                        }
                    } catch (reqError) {
                        const errData = reqError.response ? JSON.stringify(reqError.response.data) : 'N/A';
                        console.error(`❌ [CORA-REQ-ERR] Falha ao consultar ID ${invoice.external_id}: ${reqError.message} | Resp: ${errData}`);
                    }
                } else {
                     console.error(`❌ [CORA-SKIP] Pulo de verificação pois não há token.`);
                }
            }
             
            if (result.updated) {
                stats.updatedCount++;
                stats.details.push({ id: invoice._id, newStatus: result.newStatus });
            }

        } catch (error) { 
            console.error(`💥 [SYNC-CRASH] Erro não tratado no loop para a fatura ${invoice._id}:`, error.message);
        }
    }));

    console.log(`🏁 [SYNC-END] Finalizado. Atualizados: ${stats.updatedCount}/${stats.totalChecked}`);
    return stats;
  }

  async getAllInvoices(filters = {}, schoolId) {
    // Sync em background ao listar
    this.syncPendingInvoices(null, schoolId).catch(err => console.error("Erro no sync background:", err));
     
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