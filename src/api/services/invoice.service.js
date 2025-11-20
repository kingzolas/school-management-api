// src/api/services/invoice.service.js
const Invoice = require('../models/invoice.model.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const School = require('../models/school.model.js'); 
const whatsappService = require('./whatsapp.service.js');
const { MercadoPagoConfig, Payment } = require('mercadopago');

require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const MP_ACCESS_TOKEN = isProduction 
  ? process.env.MP_ACCESS_TOKEN_PROD 
  : process.env.MP_ACCESS_TOKEN_TEST;

const NOTIFICATION_BASE_URL = isProduction 
  ? process.env.PROD_URL 
  : process.env.NGROK_URL;

if (!MP_ACCESS_TOKEN) console.error('MP_ACCESS_TOKEN não definido.');
if (!NOTIFICATION_BASE_URL) console.error('URL de notificação não definida.');

// Configuração SDK Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN,
  options: { timeout: 5000 }
});
const paymentClient = new Payment(client);

// ==============================================================================
// TEMPLATES DE MENSAGENS (ANTI-BANIMENTO)
// O sistema escolherá um destes aleatoriamente a cada envio.
// ==============================================================================

const TEMPLATES_CRIACAO = [
    "Olá {tutor}! Tudo bem? 😊\nEstamos enviando a fatura referente a: *{descricao}*.\n📅 Vencimento: {vencimento}\n💰 Valor: R$ {valor}\n\nPara facilitar, o código Pix Copia e Cola segue na mensagem abaixo:",
    
    "Oi {tutor}, como vai?\nA mensalidade (*{descricao}*) já está disponível para pagamento.\nValor: R$ {valor} - Vence em: {vencimento}.\n\nUse o código abaixo no seu banco:",
    
    "Academy Hub Informa: Fatura disponível.\n📝 Referência: {descricao}\n💲 Total: R$ {valor}\n🗓️ Vencimento: {vencimento}.\n\nSegue o Pix Copia e Cola:"
];

const TEMPLATES_LEMBRETE = [
    "Bom dia {tutor}! Lembrando que a mensalidade de *{aluno}* vence hoje ({vencimento}).\nValor: R$ {valor}.\nEvite juros realizando o pagamento pelo Pix abaixo:",
    
    "Olá {tutor}, hoje é o dia do vencimento da fatura do(a) *{aluno}*.\nReferente a: {descricao}\nTotal: R$ {valor}.\n\nSegue o código para pagamento rápido:",
    
    "Oi! Passando para lembrar do pagamento referente a *{descricao}* que vence hoje.\nAluno: {aluno}\n\nCopie o código abaixo para pagar no app do seu banco:"
];

// ==============================================================================

class InvoiceService {
 
  /**
  * Cria fatura, gera PIX no MP e salva com school_id
  */
  async createInvoice(invoiceData, schoolId) {
    const { studentId, tutorId, value, dueDate, description } = invoiceData;

    // 1. Validações de Segurança
    const student = await Student.findOne({ _id: studentId, school_id: schoolId });
    if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

    const tutor = await Tutor.findOne({ _id: tutorId, school_id: schoolId });
    if (!tutor) throw new Error('Tutor não encontrado ou não pertence a esta escola.');

    if (!tutor.cpf || tutor.cpf.length < 11) throw new Error('Tutor sem CPF válido.');
    
    // Verifica se o tutor tem e-mail (em produção)
    if (!tutor.email && isProduction) throw new Error('Tutor sem e-mail válido.');

    // Lógica de e-mail para Sandbox vs Produção
    const payerEmail = (isProduction && tutor.email) ? tutor.email : "test_user_123@testuser.com";
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
        email: payerEmail,
        first_name: tutor.fullName.split(' ')[0],
        last_name: tutor.fullName.split(' ').slice(1).join(' ') || 'Sobrenome',
        identification: {
          type: 'CPF',
          number: tutor.cpf.replace(/\D/g, ''),
        },
      },
      metadata: { school_id: schoolId.toString() } 
    };

    try {
      console.log('[MP Service] Criando pagamento PIX...');
      const paymentResponse = await paymentClient.create({ body: paymentBody });
      const payment = paymentResponse;
      const paymentId = payment.id.toString();

      if (!payment.point_of_interaction?.transaction_data) {
        throw new Error('Dados do PIX não retornados pelo Mercado Pago.');
      }

      const newInvoice = new Invoice({
        student: studentId,
        tutor: tutorId,
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
      // Chama o novo método inteligente que escolhe a mensagem
      this.notifyInvoiceSmart(schoolId, tutor, student, newInvoice, 'criacao')
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
   * - Verifica conexão
   * - Formata valores e datas
   * - Sorteia mensagem (Anti-ban)
   * - Envia Pix separado
   * * @param type 'criacao' | 'lembrete'
   */
  async notifyInvoiceSmart(schoolId, tutor, student, invoice, type = 'criacao') {
      console.log(`[Zap] Iniciando envio inteligente (${type})...`);

      // 1. Verifica se a escola tem WhatsApp Conectado
      const school = await School.findById(schoolId);
      
      if (!school || school.whatsapp?.status !== 'connected') {
          console.log(`[Zap] Escola ${schoolId} não conectada. Abortando.`);
          return; 
      }

      // 2. Identifica o telefone
      const phone = tutor.phoneNumber || tutor.telefone || tutor.celular; 
      if (!phone) {
          console.warn(`[Zap] Tutor ${tutor._id} sem telefone.`);
          return;
      }

      // 3. Formatação dos dados para a mensagem
      const valorFormatado = (invoice.value / 100).toFixed(2).replace('.', ',');
      
      // Ajuste de Timezone para exibir a data correta no Brasil
      const dataFormatada = new Date(invoice.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
      
      const primeiroNome = tutor.fullName.split(' ')[0];

      // 4. Seleção Aleatória de Template (ANTI-BAN)
      const listaTemplates = type === 'lembrete' ? TEMPLATES_LEMBRETE : TEMPLATES_CRIACAO;
      const templateEscolhido = listaTemplates[Math.floor(Math.random() * listaTemplates.length)];

      // 5. Montagem da Mensagem (Substituição de variáveis)
      const msgTexto = templateEscolhido
          .replace('{tutor}', primeiroNome)
          .replace('{aluno}', student.fullName)
          .replace('{descricao}', invoice.description)
          .replace('{valor}', valorFormatado)
          .replace('{vencimento}', dataFormatada);

      // 6. Envio Sequencial
      try {
          // A) Envia o Texto Explicativo
          await whatsappService.sendText(schoolId, phone, msgTexto);
          
          // B) Delay de segurança (1.5s) para garantir a ordem visual no celular do cliente
          await new Promise(r => setTimeout(r, 1500));

          // C) Envia APENAS o código Pix (Copia e Cola)
          if (invoice.mp_pix_copia_e_cola) {
              await whatsappService.sendText(schoolId, phone, invoice.mp_pix_copia_e_cola);
          }
          
          console.log(`[Zap] Mensagens enviadas com sucesso para ${phone}`);
      } catch (error) {
          console.error(`[Zap] Erro ao enviar mensagem:`, error.message);
      }
  }

  /**
   * [NOVO] Método para Cobrança Automática (Cron Job)
   * Busca faturas vencendo HOJE e dispara os lembretes.
   */
  async processDailyReminders() {
      console.log('⏰ [Service] Processando lembretes de vencimento...');
      
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      
      const amanha = new Date(hoje);
      amanha.setDate(amanha.getDate() + 1);

      // Busca faturas PENDENTES que vencem HOJE
      const faturasVencendo = await Invoice.find({
          status: 'pending',
          dueDate: { $gte: hoje, $lt: amanha }
      }).populate('student').populate('tutor');

      console.log(`🔎 Encontradas ${faturasVencendo.length} faturas vencendo hoje.`);

      for (const fatura of faturasVencendo) {
          // Dispara notificação do tipo 'lembrete'
          await this.notifyInvoiceSmart(
              fatura.school_id, 
              fatura.tutor, 
              fatura.student, 
              fatura, 
              'lembrete'
          );
          
          // Pequeno delay entre um aluno e outro para não sobrecarregar a API
          await new Promise(r => setTimeout(r, 2000));
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
  * Webhook Handler - Não recebe schoolId, pois o ID do MP é global.
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
      paymentDetails = await this.getMpPaymentStatus(paymentId);
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
    
    // Retorna o payload completo + a flag 'processed: true'
    return { 
      processed: true,
      // Passa o school_id do documento para a consulta segura
      invoice: await this.getInvoiceById(invoice.id, invoice.school_id), 
      mpStatus 
    };
  }

  // --- Helpers ---

  async getMpPaymentStatus(paymentId) {
    try {
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