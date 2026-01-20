const Invoice = require('../models/invoice.model.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const School = require('../models/school.model.js'); 
const whatsappService = require('./whatsapp.service.js');
const GatewayFactory = require('../gateways/gateway.factory.js');
const { v4: uuidv4 } = require('uuid'); // Garante que o uuid esteja importado se usado no payload

// Templates de mensagens (Mantidos)
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
   * Cria fatura (MP ou Cora) e salva com school_id
   */
  async createInvoice(invoiceData, schoolId) {
    const { studentId, value, dueDate, description, tutorId } = invoiceData;

    // ======================================================================
    // CORREÇÃO AQUI: Adicionado .lean() ao final da busca
    // ======================================================================
    const school = await School.findById(schoolId)
        .select([
            '+mercadoPagoConfig.prodAccessToken',
            '+mercadoPagoConfig.prodClientId',
            '+mercadoPagoConfig.prodClientSecret',
            '+coraConfig.sandbox.clientId',
            '+coraConfig.sandbox.certificateContent',
            '+coraConfig.sandbox.privateKeyContent',
            '+coraConfig.production.clientId',
            '+coraConfig.production.certificateContent',
            '+coraConfig.production.privateKeyContent'
        ].join(' '))
        .lean(); // <--- O SEGREDO: Converte para Objeto JS puro, garantindo que os campos venham.

    if (!school) throw new Error('Escola não encontrada.');

    // --- DEBUG DE SEGURANÇA (Remova em produção se desejar) ---
    if (school.preferredGateway === 'CORA') {
        const isSandbox = school.coraConfig?.isSandbox;
        const creds = isSandbox ? school.coraConfig?.sandbox : school.coraConfig?.production;
        
        console.log('🔍 [DEBUG InvoiceService] Verificando Credenciais Cora antes da Factory:');
        console.log(`   - Modo: ${isSandbox ? 'SANDBOX' : 'PRODUÇÃO'}`);
        console.log(`   - ClientID existe? ${!!creds?.clientId}`);
        console.log(`   - Certificado existe? ${!!creds?.certificateContent} (Tam: ${creds?.certificateContent?.length || 0})`);
        console.log(`   - Chave existe? ${!!creds?.privateKeyContent} (Tam: ${creds?.privateKeyContent?.length || 0})`);

        if (!creds?.clientId || !creds?.certificateContent) {
            console.error('❌ [CRÍTICO] O Mongoose retornou a escola, mas os campos secretos vieram vazios!');
        }
    }
    // -----------------------------------------------------------

    // 2. Validações de Aluno (Lógica original)
    const student = await Student.findOne({ _id: studentId, school_id: schoolId })
        .populate('financialTutorId');

    if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

    // 3. Determinação de quem paga (Lógica original)
    let payerName, payerCpf, payerEmail, payerPhone;
    let linkedTutorId = null;

    if (student.financialResp === 'STUDENT') {
        // --- PAGADOR: ALUNO ---
        if (!student.cpf) throw new Error('Aluno responsável sem CPF cadastrado.');
        payerName = student.fullName;
        payerCpf = student.cpf;
        payerEmail = student.email;
        payerPhone = student.phoneNumber;
        linkedTutorId = null;
    } else {
        // --- PAGADOR: TUTOR ---
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

    // 4. Instancia o Gateway correto
    const gateway = GatewayFactory.create(school);

    // 5. Prepara Payload Genérico
    const finalEmail = payerEmail || "pagador_sem_email@academyhub.com"; 
    
    // Gerar um ID interno temporário
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
            email: finalEmail
        }
    };

    try {
      console.log(`[InvoiceService] Gerando cobrança via ${gateway.constructor.name}...`);
      
      // 6. Chama o Gateway
      const result = await gateway.createInvoice(paymentPayload);

      // 7. Salva a Fatura
      const newInvoice = new Invoice({
        _id: tempId,
        student: studentId,
        tutor: linkedTutorId,
        school_id: schoolId, 
        description,
        value: value, 
        dueDate: dueDate,
        status: 'pending',
        
        // Dados do Gateway
        gateway: result.gateway,
        external_id: result.external_id,
        
        // Dados Padronizados
        boleto_url: result.boleto_url,
        boleto_barcode: result.boleto_barcode,
        pix_code: result.pix_code,
        pix_qr_base64: result.pix_qr_base64,

        // Compatibilidade Legado
        mp_payment_id: result.gateway === 'mercadopago' ? result.external_id : undefined,
        mp_pix_copia_e_cola: result.pix_code,
        mp_ticket_url: result.boleto_url
      });

      await newInvoice.save();

      // 8. Notificação WhatsApp
      this.notifyInvoiceSmart(schoolId, payerName, payerPhone, student.fullName, newInvoice, 'criacao')
          .catch(err => console.error('⚠️ Falha ao enviar notificação WhatsApp:', err.message));

      return await this.getInvoiceById(newInvoice._id, schoolId);

    } catch (error) {
      console.error('❌ ERRO Create Invoice:', error);
      throw new Error(`Falha na criação da fatura: ${error.message}`);
    }
  }

  /**
   * Notificação WhatsApp Atualizada
   */
  async notifyInvoiceSmart(schoolId, payerName, payerPhone, studentName, invoice, type = 'criacao') {
      const school = await School.findById(schoolId).lean(); // Usei lean aqui também por performance
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

  // Cron Job
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
    
    // CORREÇÃO TAMBÉM NO CANCELAMENTO
    const school = await School.findById(schoolId)
        .select([
            '+mercadoPagoConfig.prodAccessToken',
            '+mercadoPagoConfig.prodClientId',
            '+mercadoPagoConfig.prodClientSecret',
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
    }

    invoice.status = 'canceled';
    await invoice.save();
    return invoice;
  }

  async handlePaymentWebhook(externalId, providerName, statusRaw) {
    let invoice = await Invoice.findOne({ 
        $or: [
            { external_id: externalId },
            { mp_payment_id: externalId }
        ]
    });

    if (!invoice) return { processed: false, reason: 'not_found' };

    let novoStatus = invoice.status;
    const statusPago = ['approved', 'paid', 'COMPLETED', 'LIQUIDATED'];
    const statusCancelado = ['cancelled', 'rejected', 'CANCELED'];

    if (statusPago.includes(statusRaw)) {
        novoStatus = 'paid';
    } else if (statusCancelado.includes(statusRaw)) {
        novoStatus = 'canceled';
    }

    if (invoice.status !== novoStatus) {
      invoice.status = novoStatus;
      if (novoStatus === 'paid' && !invoice.paidAt) { 
        invoice.paidAt = new Date();
      }
      await invoice.save();
      console.log(`[Webhook] Fatura ${invoice._id} atualizada para ${novoStatus} via ${providerName}`);
    }
    
    return { processed: true, invoice };
  }

  // --- Helpers ---
  async getAllInvoices(filters = {}, schoolId) {
    const query = { school_id: schoolId }; 
    if (filters.status) query.status = filters.status;
    return Invoice.find(query).sort({ dueDate: -1 }).populate('student', 'fullName').populate('tutor', 'fullName');
  }

  async getInvoiceById(invoiceId, schoolId) {
    return Invoice.findOne({ _id: invoiceId, school_id: schoolId }) 
      .populate('student', 'fullName profilePicture')
      .populate('tutor', 'fullName');
  }

  async getInvoicesByStudent(studentId, schoolId) {
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