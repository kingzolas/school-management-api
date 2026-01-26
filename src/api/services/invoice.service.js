// src/api/services/invoice.service.js
const Invoice = require('../models/invoice.model.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const School = require('../models/school.model.js'); 
const whatsappService = require('./whatsapp.service.js');
const GatewayFactory = require('../gateways/gateway.factory.js');
const { v4: uuidv4 } = require('uuid'); 
const axios = require('axios');
const https = require('https');
const { PDFDocument } = require('pdf-lib');

// Templates de mensagens para WhatsApp
const TEMPLATES_CRIACAO = [
    "Olá {nome}! Tudo bem? 😊\nEstamos enviando a fatura referente a: *{descricao}*.\n📅 Vencimento: {vencimento}\n💰 Valor: R$ {valor}\n\nPara facilitar, os dados de pagamento seguem abaixo:",
    "Oi {nome}, como vai?\nA mensalidade (*{descricao}*) já está disponível.\nValor: R$ {valor} - Vence em: {vencimento}.\n\nUse os dados abaixo para quitar:",
    "Academy Hub Informa: Fatura disponível.\n📝 Referência: {descricao}\n💲 Total: R$ {valor}\n🗓️ Vencimento: {vencimento}.\n\nSegue link/código para pagamento:"
];

const TEMPLATES_LEMBRETE = [
    "Bom dia {nome}! Lembrando que a mensalidade vence hoje ({vencimento}).\nValor: R$ {valor}.\nEvite juros realizando o pagamento pelo link abaixo:",
    "Olá {nome}, hoje é o dia do vencimento da fatura.\nReferente a: {descricao}\nTotal: R$ {valor}.\n\nSegue o código/link para pagamento rápido:",
    "Oi! Passando para lembrar do pagamento referente a *{descricao}* que vence hoje.\n\nCopie o código ou acesse o link abaixo:"
];

class InvoiceService {

    

  /**
   * Cria fatura (Mercado Pago ou Cora) e salva no banco
   */
  async createInvoice(invoiceData, schoolId) {
    const { studentId, value, dueDate, description, tutorId, gateway: chosenGateway } = invoiceData;

    // 1. Busca configurações da Escola (Incluindo campos protegidos e usando lean para performance/segurança)
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
        '+coraConfig.production.privateKeyContent'
    ].join(' ');

    const school = await School.findById(schoolId).select(selectString).lean(); 

    if (!school) throw new Error('Escola não encontrada.');

    // 2. Validações de Aluno
    const student = await Student.findOne({ _id: studentId, school_id: schoolId })
        .populate('financialTutorId');

    if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

    // 3. Limpeza e Validação do Endereço (CRÍTICO para evitar erro 400 na Cora)
    const rawAddr = student.address || {};
    
    // Remove tudo que não for número do CEP
    let cleanZip = (rawAddr.zipCode || rawAddr.cep || '').replace(/\D/g, '');
    
    // Validação de segurança: Se o CEP for inválido ou vazio, usa um CEP real de SP (Av. Paulista) 
    // para garantir que a validação bancária do Sandbox passe sem erro de "Cidade Inválida".
    if (cleanZip.length !== 8) {
        console.warn('⚠️ [InvoiceService] CEP inválido ou ausente. Usando endereço de fallback (SP) para evitar rejeição.');
        cleanZip = '01310100'; 
    }

    // Monta objeto de endereço limpo
    const cleanAddress = {
        street: rawAddr.street || 'Rua não informada',
        number: rawAddr.number || '0',
        district: rawAddr.neighborhood || rawAddr.district || 'Bairro',
        city: rawAddr.city || 'São Paulo',
        state: (rawAddr.state && rawAddr.state.length === 2) ? rawAddr.state : 'SP',
        zip_code: cleanZip 
    };

    // 4. Determinação de quem paga (Aluno ou Tutor)
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

    if (!payerPhone) console.warn(`Aviso: Pagador ${payerName} sem telefone.`);

    // 5. Instancia o Gateway e Prepara Payload
    const gateway = GatewayFactory.create(school, chosenGateway);
    
    // Garante e-mail válido (obrigatório em alguns gateways)
    const finalEmail = (payerEmail && payerEmail.includes('@')) 
        ? payerEmail 
        : "pagador_sem_email@academyhub.com"; 
    
    const tempId = new Invoice()._id; 

    // Payload Unificado (Sem Juros/Multa para estabilidade inicial)
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
            address: cleanAddress // Usa o endereço tratado
        }
    };

    try {
      console.log(`[InvoiceService] Gerando cobrança via ${gateway.constructor.name}...`);
      
      // 6. Chamada ao Gateway
      const result = await gateway.createInvoice(paymentPayload);

      // 7. Salva a Fatura no Banco
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
        
        // Campos de compatibilidade para Mercado Pago
        mp_payment_id: result.gateway === 'mercadopago' ? result.external_id : undefined,
        mp_pix_copia_e_cola: result.pix_code,
        mp_ticket_url: result.boleto_url
      });

      await newInvoice.save();

      // 8. Envia Notificação WhatsApp (Async - não trava a resposta)
      this.notifyInvoiceSmart(schoolId, payerName, payerPhone, student.fullName, newInvoice, 'criacao')
          .catch(err => console.error('⚠️ Falha ao enviar notificação WhatsApp:', err.message));

      // Retorna a fatura populada
      return await this.getInvoiceById(newInvoice._id, schoolId);

    } catch (error) {
      console.error('❌ ERRO Create Invoice:', error.message);
      // Se for erro da Cora já formatado pelo Gateway, repassa
      if (error.message.includes('Erro Cora')) {
          throw error; 
      }
      throw new Error(`Falha na criação da fatura: ${error.message}`);
    }
  }

  // --- MÉTODOS AUXILIARES ---

  async notifyInvoiceSmart(schoolId, payerName, payerPhone, studentName, invoice, type = 'criacao') {
      const school = await School.findById(schoolId).lean();
      if (!school || school.whatsapp?.status !== 'connected') return;
      if (!payerPhone) return;

      const valorFormatado = (invoice.value / 100).toFixed(2).replace('.', ',');
      const dataFormatada = new Date(invoice.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
      const primeiroNome = payerName.split(' ')[0];

      const listaTemplates = type === 'lembrete' ? TEMPLATES_LEMBRETE : TEMPLATES_CRIACAO;
      const templateEscolhido = listaTemplates[Math.floor(Math.random() * listaTemplates.length)];

      const msgTexto = templateEscolhido
          .replace('{nome}', primeiroNome)
          .replace('{descricao}', invoice.description)
          .replace('{valor}', valorFormatado)
          .replace('{vencimento}', dataFormatada);

      try {
          await whatsappService.sendText(schoolId, payerPhone, msgTexto);
          // Pequeno delay para garantir ordem de entrega
          await new Promise(r => setTimeout(r, 1000));

          if (invoice.boleto_url) {
             await whatsappService.sendText(schoolId, payerPhone, `📄 Visualizar Boleto:\n${invoice.boleto_url}`);
             await new Promise(r => setTimeout(r, 1000));
          }
          if (invoice.boleto_barcode) {
             await whatsappService.sendText(schoolId, payerPhone, "Linha digitável (copie abaixo):");
             await whatsappService.sendText(schoolId, payerPhone, invoice.boleto_barcode);
          }
          if (invoice.pix_code) {
             await whatsappService.sendText(schoolId, payerPhone, "💠 Pix Copia e Cola:");
             await whatsappService.sendText(schoolId, payerPhone, invoice.pix_code);
          }
      } catch (error) {
          console.error(`[Zap] Erro ao enviar mensagem:`, error.message);
      }
  }

  async processDailyReminders() {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const amanha = new Date(hoje);
      amanha.setDate(amanha.getDate() + 1);

      const faturasVencendo = await Invoice.find({
          status: 'pending',
          dueDate: { $gte: hoje, $lt: amanha }
      }).populate('student').populate('tutor');

      console.log(`🔎 Cron: Encontradas ${faturasVencendo.length} faturas vencendo hoje.`);

      for (const fatura of faturasVencendo) {
          let targetName, targetPhone;
          if (fatura.tutor) {
              targetName = fatura.tutor.fullName;
              targetPhone = fatura.tutor.phoneNumber || fatura.tutor.telefone;
          } else if (fatura.student) {
              targetName = fatura.student.fullName;
              targetPhone = fatura.student.phoneNumber;
          }
          if (targetName && targetPhone) {
              await this.notifyInvoiceSmart(fatura.school_id, targetName, targetPhone, fatura.student.fullName, fatura, 'lembrete');
              await new Promise(r => setTimeout(r, 2000));
          }
      }
  }

  async cancelInvoice(invoiceId, schoolId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, school_id: schoolId });
    if (!invoice) throw new Error('Fatura não encontrada');
    if (invoice.status === 'paid') throw new Error('Fatura já PAGA não pode ser cancelada.');
    
    // Busca credenciais para cancelar no Gateway
    const school = await School.findById(schoolId)
        .select([
            '+mercadoPagoConfig.prodAccessToken',
            '+coraConfig.sandbox.clientId',
            '+coraConfig.sandbox.certificateContent',
            '+coraConfig.sandbox.privateKeyContent',
            '+coraConfig.production.clientId',
            '+coraConfig.production.certificateContent',
            '+coraConfig.production.privateKeyContent'
        ].join(' '))
        .lean();
    
    const gatewayName = invoice.gateway === 'cora' ? 'CORA' : 'MERCADOPAGO';
    
    try {
        const gateway = GatewayFactory.create(school, gatewayName);
        if (invoice.external_id) {
            await gateway.cancelInvoice(invoice.external_id);
        }
    } catch (error) {
        console.warn(`Erro ao cancelar no gateway (${gatewayName}):`, error.message);
        // Não impedimos o cancelamento local se o gateway falhar (ex: boleto já baixado)
    }

    invoice.status = 'canceled';
    await invoice.save();
    return invoice;
  }

  async handlePaymentWebhook(externalId, providerName, statusRaw) {
    // Busca fatura pelo ID externo do Gateway
    let invoice = await Invoice.findOne({ 
        $or: [ { external_id: externalId }, { mp_payment_id: externalId } ]
    });
    if (!invoice) return { processed: false, reason: 'not_found' };

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

    if (invoice.status !== novoStatus) {
      invoice.status = novoStatus;
      if (novoStatus === 'paid' && !invoice.paidAt) invoice.paidAt = new Date();
      await invoice.save();
      console.log(`✅ [DB UPDATE] Fatura ${invoice._id} SALVA como ${novoStatus} (Origem: ${providerName})`);
    }
    return { processed: true, invoice };
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

    if (!invoices.length) {
        throw new Error("Nenhuma fatura com boleto/PDF encontrada para impressão.");
    }

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

    if (processedCount === 0) {
        throw new Error("Falha ao processar os arquivos PDF. Verifique se os links dos boletos estão acessíveis.");
    }

    return await mergedPdf.save();
  }

  // Sincronização passiva (verifica status ao listar)
  async syncPendingInvoices(studentId, schoolId, singleInvoiceId = null) {
    const filter = {
        school_id: schoolId,
        status: 'pending',
        gateway: { $in: ['cora', 'mercadopago'] },
        external_id: { $exists: true }
    };
    if (studentId) filter.student = studentId;
    if (singleInvoiceId) filter._id = singleInvoiceId;

    const pendingInvoices = await Invoice.find(filter);
    if (pendingInvoices.length === 0) return;

    // Busca credenciais
    const school = await School.findById(schoolId).select([
        '+mercadoPagoConfig.prodAccessToken',
        'coraConfig.isSandbox',
        '+coraConfig.sandbox.clientId',
        '+coraConfig.sandbox.certificateContent',
        '+coraConfig.sandbox.privateKeyContent',
        '+coraConfig.production.clientId',
        '+coraConfig.production.certificateContent',
        '+coraConfig.production.privateKeyContent'
    ].join(' ')).lean();

    if (!school) return;

    // Lógica simplificada de sync (Cora e MP)
    await Promise.all(pendingInvoices.map(async (invoice) => {
        try {
            if (invoice.gateway === 'cora') {
                // Aqui instancia-se o gateway apenas para usar o método authenticate/consultar se existisse
                // Como não implementamos 'consultar' no gateway básico, pulamos por enquanto ou usamos axios direto
            } else if (invoice.gateway === 'mercadopago') {
                const mpToken = school.mercadoPagoConfig?.prodAccessToken;
                if (!mpToken) return;
                const res = await axios.get(`https://api.mercadopago.com/v1/payments/${invoice.external_id}`, { headers: { 'Authorization': `Bearer ${mpToken}` } });
                const statusMP = res.data.status;
                await this.handlePaymentWebhook(invoice.external_id, 'MP-SYNC', statusMP);
            }
        } catch (error) { /* Silent fail no sync */ }
    }));
  }

  // --- Getters ---
  async getAllInvoices(filters = {}, schoolId) {
    try { await this.syncPendingInvoices(null, schoolId); } catch (e) {}
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