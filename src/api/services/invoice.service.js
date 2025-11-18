// src/api/services/invoice.service.js
const Invoice = require('../models/invoice.model.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
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

class InvoiceService {
 
  /**
  * Cria fatura, gera PIX no MP e salva com school_id
  */
  async createInvoice(invoiceData, schoolId) {
    const { studentId, tutorId, value, dueDate, description } = invoiceData;

    // 1. Validações de Segurança (Verifica se Aluno e Tutor pertencem à escola)
    const student = await Student.findOne({ _id: studentId, school_id: schoolId });
    if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

    const tutor = await Tutor.findOne({ _id: tutorId, school_id: schoolId });
    if (!tutor) throw new Error('Tutor não encontrado ou não pertence a esta escola.');

    if (!tutor.cpf || tutor.cpf.length < 11) throw new Error('Tutor sem CPF válido.');
    if (!tutor.email) throw new Error('Tutor sem e-mail válido.');

    // Lógica de e-mail para Sandbox
    const payerEmail = isProduction ? tutor.email : "test_user_123@testuser.com";

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
      // Adiciona o ID da escola ao metadata para facilitar o rastreamento no webhook (opcional)
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
        school_id: schoolId, // [NOVO] Salva o ID da escola
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
      return await this.getInvoiceById(newInvoice._id, schoolId);

    } catch (error) {
      console.error('❌ ERRO MP Create:', error);
      throw new Error(`Falha na criação da fatura: ${error.message}`);
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
    // ... (Mantém a lógica inalterada, pois o Webhook é global e busca por mp_payment_id) ...
    // A segurança da fatura já está no registro (school_id), mas a operação do webhook 
    // é apenas de *update* e não de consulta multi-tenant.
    
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
        // A data de pagamento só é preenchida aqui pelo Webhook.
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

  /**
  * Busca todas as faturas da escola do usuário logado.
  */
  async getAllInvoices(filters = {}, schoolId) {
    const query = { school_id: schoolId }; // [NOVO] Filtro obrigatório
    if (filters.status) query.status = filters.status;

    return Invoice.find(query)
      .sort({ dueDate: -1 })
      .populate('student', 'fullName profilePicture')
      .populate('tutor', 'fullName');
  }

  /**
  * Busca uma fatura específica da escola do usuário logado.
  */
  async getInvoiceById(invoiceId, schoolId) {
    return Invoice.findOne({ _id: invoiceId, school_id: schoolId }) // [NOVO] Filtro obrigatório
      .populate('student', 'fullName profilePicture')
      .populate('tutor', 'fullName');
  }

  /**
  * Busca faturas de um aluno específico, garantindo que o aluno pertença à escola.
  */
  async getInvoicesByStudent(studentId, schoolId) {
    // Busca faturas onde o studentId é o fornecido E o school_id é o do usuário
    return Invoice.find({ student: studentId, school_id: schoolId }) // [NOVO] Filtro obrigatório
      .sort({ dueDate: -1 })
      .populate('tutor', 'fullName');
  }

  async findOverdue(schoolId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return Invoice.find({
      school_id: schoolId, // [NOVO] Filtro obrigatório
      dueDate: { $lt: today },
      status: { $nin: ['paid', 'canceled'] }
    })
    .select('description value dueDate student')
    .populate('student', 'fullName')
    .lean();
  }
}

module.exports = new InvoiceService();