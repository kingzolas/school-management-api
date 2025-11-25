const Invoice = require('../models/invoice.model.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const School = require('../models/school.model.js'); 
const whatsappService = require('./whatsapp.service.js');
const { MercadoPagoConfig, Payment } = require('mercadopago');

require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// A URL de notificação continua global ou pode ser ajustada conforme sua infra
const NOTIFICATION_BASE_URL = isProduction 
  ? process.env.PROD_URL 
  : process.env.NGROK_URL;

if (!NOTIFICATION_BASE_URL) console.error('URL de notificação não definida.');

// ==============================================================================
// TEMPLATES DE MENSAGENS (ANTI-BANIMENTO)
// ==============================================================================

const TEMPLATES_CRIACAO = [
    "Olá {nome}! Tudo bem? 😊\nEstamos enviando a fatura referente a: *{descricao}*.\n📅 Vencimento: {vencimento}\n💰 Valor: R$ {valor}\n\nPara facilitar, o código Pix Copia e Cola segue na mensagem abaixo:",
    "Oi {nome}, como vai?\nA mensalidade (*{descricao}*) já está disponível para pagamento.\nValor: R$ {valor} - Vence em: {vencimento}.\n\nUse o código abaixo no seu banco:",
    "Academy Hub Informa: Fatura disponível.\n📝 Referência: {descricao}\n💲 Total: R$ {valor}\n🗓️ Vencimento: {vencimento}.\n\nSegue o Pix Copia e Cola:"
];

const TEMPLATES_LEMBRETE = [
    "Bom dia {nome}! Lembrando que a mensalidade vence hoje ({vencimento}).\nValor: R$ {valor}.\nEvite juros realizando o pagamento pelo Pix abaixo:",
    "Olá {nome}, hoje é o dia do vencimento da fatura.\nReferente a: {descricao}\nTotal: R$ {valor}.\n\nSegue o código para pagamento rápido:",
    "Oi! Passando para lembrar do pagamento referente a *{descricao}* que vence hoje.\n\nCopie o código abaixo para pagar no app do seu banco:"
];

// ==============================================================================

class InvoiceService {

  /**
   * [HELPER PRIVADO]
   * Busca as credenciais da escola e retorna uma instância configurada do Mercado Pago
   */
  async _getMpClient(schoolId) {
    const school = await School.findById(schoolId).select('+mercadoPagoConfig.prodAccessToken');
    
    if (!school) {
        throw new Error('Escola não encontrada para processar pagamento.');
    }

    if (!school.mercadoPagoConfig || !school.mercadoPagoConfig.prodAccessToken) {
        throw new Error('As credenciais do Mercado Pago não estão configuradas para esta escola.');
    }

    const client = new MercadoPagoConfig({
        accessToken: school.mercadoPagoConfig.prodAccessToken,
        options: { timeout: 5000 }
    });

    const paymentClient = new Payment(client);
    
    return { client, paymentClient };
  }
 
  /**
  * Cria fatura, gera PIX no MP e salva com school_id
  * Lógica adaptada para Alunos Pagadores (Maiores de idade) ou Tutores
  */
  async createInvoice(invoiceData, schoolId) {
    const { studentId, value, dueDate, description, tutorId } = invoiceData;

    // 1. Validações de Segurança e Identificação do Aluno
    const student = await Student.findOne({ _id: studentId, school_id: schoolId })
        .populate('financialTutorId');

    if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

    // 2. Determinação de quem paga (Payer Strategy)
    let payerName, payerCpf, payerEmail, payerPhone;
    let linkedTutorId = null;

    if (student.financialResp === 'STUDENT') {
        // --- PAGADOR: O PRÓPRIO ALUNO (MAIOR DE IDADE) ---
        if (!student.cpf) throw new Error('Aluno definido como responsável financeiro, mas não possui CPF cadastrado.');
        
        payerName = student.fullName;
        payerCpf = student.cpf;
        payerEmail = student.email;
        payerPhone = student.phoneNumber;
        linkedTutorId = null; // Fatura não vinculada a tutor, pois o aluno paga

    } else {
        // --- PAGADOR: O TUTOR ---
        let targetTutor = null;

        // Se o body da requisição forçar um tutorId, usamos ele (com validação)
        if (tutorId) {
            targetTutor = await Tutor.findOne({ _id: tutorId, school_id: schoolId });
        } 
        // Se não, usamos o tutor financeiro padrão do aluno
        else if (student.financialTutorId) {
            targetTutor = student.financialTutorId;
        }

        if (!targetTutor) throw new Error('Nenhum tutor responsável encontrado para gerar a cobrança.');

        if (!targetTutor.cpf || targetTutor.cpf.length < 11) throw new Error('Tutor responsável sem CPF válido.');
        
        payerName = targetTutor.fullName;
        payerCpf = targetTutor.cpf;
        payerEmail = targetTutor.email;
        payerPhone = targetTutor.phoneNumber || targetTutor.telefone || targetTutor.celular;
        linkedTutorId = targetTutor._id;
    }

    // Validações Finais do Pagador
    if (!payerPhone && isProduction) console.warn(`Aviso: Pagador ${payerName} sem telefone cadastrado.`);

    // 3. Configuração Mercado Pago
    const { paymentClient } = await this._getMpClient(schoolId);

    // Lógica de e-mail para Sandbox vs Produção
    const finalEmail = (isProduction && payerEmail) ? payerEmail : "test_user_123@testuser.com";
    const valorEmReais = parseFloat((value / 100).toFixed(2));
    
    const dataVencimento = new Date(dueDate);
    dataVencimento.setHours(23, 59, 59);
    const dataVencimentoISO = dataVencimento.toISOString();
    
    const notificationUrl = `${NOTIFICATION_BASE_URL}/api/webhook/mp`;

    const paymentBody = {
      transaction_amount: valorEmReais,
      description: description,
      payment_method_id: 'pix',
      notification_url: notificationUrl,
      date_of_expiration: dataVencimentoISO,
      payer: {
        email: finalEmail,
        first_name: payerName.split(' ')[0],
        last_name: payerName.split(' ').slice(1).join(' ') || 'Sobrenome',
        identification: {
          type: 'CPF',
          number: payerCpf.replace(/\D/g, ''),
        },
      },
      metadata: { school_id: schoolId.toString() } 
    };

    try {
      console.log(`[MP Service] Criando pagamento PIX para Escola ID: ${schoolId}. Pagador: ${payerName}`);
      const paymentResponse = await paymentClient.create({ body: paymentBody });
      const payment = paymentResponse;
      const paymentId = payment.id.toString();

      if (!payment.point_of_interaction?.transaction_data) {
        throw new Error('Dados do PIX não retornados pelo Mercado Pago.');
      }

      const newInvoice = new Invoice({
        student: studentId,
        tutor: linkedTutorId, // Pode ser null se o aluno pagar
        school_id: schoolId, 
        description,
        value: value, 
        dueDate: dataVencimento,
        status: 'pending',
        paymentMethod: 'pix',
        gateway: 'mercadopago',
        mp_payment_id: paymentId,
        mp_pix_copia_e_cola: payment.point_of_interaction.transaction_data.qr_code,
        mp_pix_qr_base64: payment.point_of_interaction.transaction_data.qr_code_base64,
        mp_ticket_url: payment.point_of_interaction.transaction_data.ticket_url,
      });

      await newInvoice.save();

      // --- DISPARO WHATSAPP ---
      // Passamos explicitamente os dados de contato do pagador
      this.notifyInvoiceSmart(schoolId, payerName, payerPhone, student.fullName, newInvoice, 'criacao')
          .catch(err => console.error('⚠️ Falha ao enviar notificação WhatsApp:', err.message));
      // ------------------------

      return await this.getInvoiceById(newInvoice._id, schoolId);

    } catch (error) {
      console.error('❌ ERRO MP Create:', error);
      throw new Error(`Falha na criação da fatura: ${error.message}`);
    }
  }

  /**
   * [NOVO] Método Inteligente de Notificação
   * Adaptado para receber diretamente Nome e Telefone do Pagador (seja Aluno ou Tutor)
   */
  async notifyInvoiceSmart(schoolId, payerName, payerPhone, studentName, invoice, type = 'criacao') {
      console.log(`[Zap] Iniciando envio inteligente (${type}) para ${payerName}...`);

      // 1. Verifica conexão da escola
      const school = await School.findById(schoolId);
      
      if (!school || school.whatsapp?.status !== 'connected') {
          console.log(`[Zap] Escola ${schoolId} não conectada. Abortando.`);
          return; 
      }

      // 2. Valida telefone
      if (!payerPhone) {
          console.warn(`[Zap] Pagador ${payerName} sem telefone.`);
          return;
      }

      // 3. Formatação
      const valorFormatado = (invoice.value / 100).toFixed(2).replace('.', ',');
      const dataFormatada = new Date(invoice.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
      const primeiroNome = payerName.split(' ')[0];

      // 4. Seleção Aleatória de Template (ANTI-BAN)
      const listaTemplates = type === 'lembrete' ? TEMPLATES_LEMBRETE : TEMPLATES_CRIACAO;
      const templateEscolhido = listaTemplates[Math.floor(Math.random() * listaTemplates.length)];

      // 5. Montagem da Mensagem
      // Nota: Substituímos '{tutor}' por '{nome}' nos templates para ser genérico
      const msgTexto = templateEscolhido
          .replace('{nome}', primeiroNome)
          .replace('{aluno}', studentName)
          .replace('{descricao}', invoice.description)
          .replace('{valor}', valorFormatado)
          .replace('{vencimento}', dataFormatada);

      // 6. Envio Sequencial
      try {
          // A) Envia o Texto Explicativo
          await whatsappService.sendText(schoolId, payerPhone, msgTexto);
          
          // B) Delay de segurança
          await new Promise(r => setTimeout(r, 1500));

          // C) Envia APENAS o código Pix (Copia e Cola)
          if (invoice.mp_pix_copia_e_cola) {
              await whatsappService.sendText(schoolId, payerPhone, invoice.mp_pix_copia_e_cola);
          }
          
          console.log(`[Zap] Mensagens enviadas com sucesso para ${payerPhone}`);
      } catch (error) {
          console.error(`[Zap] Erro ao enviar mensagem:`, error.message);
      }
  }

  /**
   * [NOVO] Método para Cobrança Automática (Cron Job)
   * Adaptado para detectar dinamicamente se cobra o Aluno ou Tutor
   */
  async processDailyReminders() {
      console.log('⏰ [Service] Processando lembretes de vencimento...');
      
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      
      const amanha = new Date(hoje);
      amanha.setDate(amanha.getDate() + 1);

      // Busca faturas PENDENTES que vencem HOJE
      // Popula student e tutor (se houver) para decidir quem notificar
      const faturasVencendo = await Invoice.find({
          status: 'pending',
          dueDate: { $gte: hoje, $lt: amanha }
      }).populate('student').populate('tutor');

      console.log(`🔎 Encontradas ${faturasVencendo.length} faturas vencendo hoje.`);

      for (const fatura of faturasVencendo) {
          // Lógica de quem recebe o aviso
          let targetName, targetPhone;

          // Se tem tutor vinculado na fatura, é ele
          if (fatura.tutor) {
              targetName = fatura.tutor.fullName;
              targetPhone = fatura.tutor.phoneNumber || fatura.tutor.telefone;
          } 
          // Se não tem tutor, verifica se é o aluno
          else if (fatura.student) {
              targetName = fatura.student.fullName;
              targetPhone = fatura.student.phoneNumber;
          }

          if (targetName && targetPhone) {
              // Dispara notificação do tipo 'lembrete'
              await this.notifyInvoiceSmart(
                  fatura.school_id, 
                  targetName, 
                  targetPhone, 
                  fatura.student.fullName, 
                  fatura, 
                  'lembrete'
              );
              
              // Pequeno delay entre um envio e outro
              await new Promise(r => setTimeout(r, 2000));
          } else {
              console.warn(`[Cron] Fatura ${fatura._id} sem destinatário válido para notificação.`);
          }
      }
  }

  /**
  * Cancela uma fatura (MP e Local)
  */
  async cancelInvoice(invoiceId, schoolId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, school_id: schoolId });
    if (!invoice) throw new Error('Fatura não encontrada ou não pertence à sua escola');

    if (invoice.status === 'canceled') return invoice;
    if (invoice.status === 'paid') throw new Error('Não é possível cancelar uma fatura já PAGA.');

    // 2. Tenta cancelar no Mercado Pago
    if (invoice.mp_payment_id) {
      try {
        const { paymentClient } = await this._getMpClient(schoolId);
        await paymentClient.cancel({ id: invoice.mp_payment_id });
      } catch (error) {
        console.warn(`⚠️ Aviso: Erro ao cancelar no MP (pode já estar expirado): ${error.message}`);
      }
    }

    // 3. Atualiza Localmente
    invoice.status = 'canceled';
    await invoice.save();

    return invoice;
  }

  /**
  * Webhook Handler
  */
  async handlePaymentWebhook(paymentId) {
    // 1. Busca a fatura no banco local
    const invoice = await Invoice.findOne({ mp_payment_id: paymentId });

    if (!invoice) {
        return { processed: false };
    }

    // 2. Se encontrou, é dele. Continua o processo...
    let paymentDetails;
    try {
      paymentDetails = await this.getMpPaymentStatus(paymentId, invoice.school_id);
    } catch (error) {
      return { processed: true, invoice: invoice, mpStatus: 'error_fetching' };
    }
    
    const mpStatus = paymentDetails.status;

    // 3. Mapeamento e atualização de status
    let novoStatus = invoice.status;
    if (mpStatus === 'approved' || mpStatus === 'authorized') novoStatus = 'paid';
    else if (mpStatus === 'pending') novoStatus = 'pending';
    else if (mpStatus === 'cancelled' || mpStatus === 'rejected') novoStatus = 'canceled';

    if (invoice.status !== novoStatus) {
      invoice.status = novoStatus;
      if (novoStatus === 'paid' && !invoice.paidAt) { 
        invoice.paidAt = new Date();
      }
      await invoice.save();
    }
    
    return { 
      processed: true,
      invoice: await this.getInvoiceById(invoice.id, invoice.school_id), 
      mpStatus 
    };
  }

  // --- Helpers ---

  async getMpPaymentStatus(paymentId, schoolId) {
    try {
      const { paymentClient } = await this._getMpClient(schoolId);
      const response = await paymentClient.get({ id: paymentId });
      return response; 
    } catch (error) {
      throw new Error(`Erro MP Get: ${error.message || 'Falha ao buscar dados no MP'}`);
    }
  }

  async getAllInvoices(filters = {}, schoolId) {
    const query = { school_id: schoolId }; 
    if (filters.status) query.status = filters.status;

    return Invoice.find(query)
      .sort({ dueDate: -1 })
      .populate('student', 'fullName profilePicture')
      .populate('tutor', 'fullName');
  }

  async getInvoiceById(invoiceId, schoolId) {
    return Invoice.findOne({ _id: invoiceId, school_id: schoolId }) 
      .populate('student', 'fullName profilePicture')
      .populate('tutor', 'fullName');
  }

  async getInvoicesByStudent(studentId, schoolId) {
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
    })
    .select('description value dueDate student')
    .populate('student', 'fullName')
    .lean();
  }
}

module.exports = new InvoiceService();