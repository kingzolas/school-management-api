const Invoice = require('../models/invoice.model.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const { MercadoPagoConfig, Payment } = require('mercadopago');

require('dotenv').config();

// --- LÓGICA DE AMBIENTE (PRODUÇÃO vs. TESTE) ---
const isProduction = process.env.NODE_ENV === 'production';

// [CORREÇÃO] Lendo os nomes de variáveis do SEU .env de produção
const MP_ACCESS_TOKEN = isProduction 
  ? process.env.MP_ACCESS_TOKEN_PROD // Lendo MP_ACCESS_TOKEN_PROD
  : process.env.MP_ACCESS_TOKEN_TEST;

// [CORREÇÃO] Lendo a URL base do SEU .env de produção
const NOTIFICATION_BASE_URL = isProduction 
  ? process.env.PROD_URL // Lendo PROD_URL
  : process.env.NGROK_URL;

console.log(`[MP Service] Rodando em modo: ${isProduction ? 'PRODUÇÃO' : 'TESTE'}`);

// [CORREÇÃO] Atualizando as mensagens de erro
if (!MP_ACCESS_TOKEN) {
  const varName = isProduction ? 'MP_ACCESS_TOKEN_PROD' : 'MP_ACCESS_TOKEN_TEST';
  throw new Error(`${varName} não definido no .env!`);
}
if (!NOTIFICATION_BASE_URL) {
  const varName = isProduction ? 'PROD_URL' : 'NGROK_URL';
  throw new Error(`URL de notificação (${varName}) não definida no .env!`);
}
// -----------------------------------------------------------

const client = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN,
  options: { timeout: 5000 }
});

const paymentClient = new Payment(client);

class InvoiceService {
  /**
   * Cria uma nova fatura e gera a cobrança PIX no Mercado Pago
   */
  async createInvoice(invoiceData) {
    const { studentId, tutorId, value, dueDate, description } = invoiceData;

    // 1. Validação dos nossos dados
    const student = await Student.findById(studentId);
    if (!student) throw new Error('Aluno não encontrado');

    const tutor = await Tutor.findById(tutorId);
    if (!tutor) throw new Error('Tutor não encontrado');

    // Validação de CPF (Obrigatório)
    if (!tutor.cpf || tutor.cpf.length < 11) {
      throw new Error(`O tutor [${tutor.fullName}] não possui CPF válido.`);
    }
    
    // Validação de E-mail (Obrigatório)
    if (!tutor.email) {
      throw new Error(`O tutor [${tutor.fullName}] não possui e-mail válido.`);
    }

    // 2. Define o E-mail do Pagador
    // Em produção, usamos o e-mail real do tutor.
    // Em teste (development), usamos o e-mail de sandbox para forçar o 'pending'.
    const payerEmail = isProduction 
      ? tutor.email 
      : "rianvitordev@gmail.com"; // E-mail que funcionou para criar 'pending'

    console.log(`[MP Service] Usando e-mail de pagador: ${payerEmail}`);

    // 3. Preparar dados para o Mercado Pago
    // [CORREÇÃO] O 'value' que vem do Postman (ex: 200) já está em CENTAVOS
    // Convertemos para Reais (ex: 2.00) para enviar ao MP
    const valorEmReais = parseFloat((value / 100).toFixed(2));
    const dataVencimento = new Date(dueDate);
    dataVencimento.setHours(23, 59, 59);
    const dataVencimentoISO = dataVencimento.toISOString();
    const notificationUrl = `${NOTIFICATION_BASE_URL}/api/webhook/mp`;

    const paymentBody = {
      transaction_amount: valorEmReais, // Ex: 2.00
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
    };

    // 4. Enviar para o Mercado Pago
    try {
      console.log('[MP Service] Enviando requisição de pagamento...');
      const paymentResponse = await paymentClient.create({ body: paymentBody });
      console.log('[MP Service] Resposta recebida.');

      const payment = paymentResponse;
      const paymentId = payment.id.toString();

      if (!payment.point_of_interaction?.transaction_data) {
        throw new Error('Resposta do MP não incluiu dados do PIX (point_of_interaction).');
      }

      // 5. Salvar a fatura no nosso banco (MongoDB)
      const newInvoice = new Invoice({
        student: studentId,
        tutor: tutorId,
        description,
        value: value, // Salva o valor em CENTAVOS (como veio do req.body)
        dueDate: dataVencimento,
        status: 'pending', // <<< Status inicial do seu Model
        paymentMethod: 'pix',
        gateway: 'mercadopago',
        mp_payment_id: paymentId,
        mp_pix_copia_e_cola: payment.point_of_interaction.transaction_data.qr_code,
        mp_pix_qr_base64: payment.point_of_interaction.transaction_data.qr_code_base64,
        mp_ticket_url: payment.point_of_interaction.transaction_data.ticket_url,
      });

      await newInvoice.save();
      console.log(`✅ Cobrança PIX [${paymentId}] gerada no Mercado Pago.`);

      const populatedInvoice = await this.getInvoiceById(newInvoice._id);
      return populatedInvoice;

    } catch (error) {
      console.error('❌ ERRO ao gerar cobrança no Mercado Pago:');
      const errorData = error.cause?.data || error.response?.data || error.message;
      console.error(JSON.stringify(errorData, null, 2));
      throw new Error(`Falha ao processar fatura com o Mercado Pago: ${error.message}`);
    }
  }

  
  /**
   * Lida com o webhook de pagamento recebido do Mercado Pago
   */
  async handlePaymentWebhook(paymentId) {
    console.log(`🔔 Webhook MP recebido. Processando pagamento ID: ${paymentId}`);
    
    // 1. Busca o status do pagamento na API do MP
    const paymentDetails = await this.getMpPaymentStatus(paymentId);
    const mpStatus = paymentDetails.status; // Ex: "approved", "pending", "cancelled"
    console.log(`[MP Webhook] Status do Pagamento [${paymentId}]: ${mpStatus}`); // DEBUG

    // 2. Encontra a fatura no NOSSO banco de dados
    const invoice = await Invoice.findOne({ mp_payment_id: paymentId });
    if (!invoice) {
      console.warn(`⚠️ Alerta de Webhook: Fatura com mp_payment_id [${paymentId}] não encontrada.`);
      // Retorna null (ou um objeto de erro) para o controller saber que falhou
      return { invoice: null, mpStatus: 'not_found' };
    }

    // 3. Converte o status do MP para o nosso status interno
    let nossoStatus = invoice.status;
    if (mpStatus === 'approved' || mpStatus === 'authorized') {
      nossoStatus = 'paid'; // <<< Status do seu Model
    } else if (mpStatus === 'pending') {
      nossoStatus = 'pending'; // <<< Status do seu Model
    } else if (mpStatus === 'cancelled' || mpStatus === 'rejected') {
      nossoStatus = 'canceled'; // <<< Status do seu Model
    }

    // 4. Atualiza a fatura somente se o status mudou
    if (invoice.status !== nossoStatus) {
      invoice.status = nossoStatus;
      if (nossoStatus === 'paid') {
        invoice.paidAt = new Date();
      }
      await invoice.save();
      console.log(`✅ Fatura [${invoice._id}] atualizada para ${nossoStatus} via webhook MP.`);
    } else {
      console.log(`ℹ️ Info Webhook: Status [${nossoStatus}] já estava sincronizado.`);
    }
    
    const populatedInvoice = await this.getInvoiceById(invoice.id);
    return { invoice: populatedInvoice, mpStatus: mpStatus };
  }

  /**
   * Cancela uma fatura (no MP e localmente)
   */
  async cancelInvoice(invoiceId) {
    const invoice = await this.getInvoiceById(invoiceId);
    if (!invoice) throw new Error('Fatura não encontrada');

    if (invoice.status === 'paid') {
      throw new Error('Não é possível cancelar uma fatura que já foi paga.');
    }

    // Tenta cancelar no Mercado Pago
    if (invoice.mp_payment_id && invoice.status === 'pending') {
      try {
        console.log(`[MP Service] Cancelando pagamento [${invoice.mp_payment_id}] no Mercado Pago...`);
        // O SDK v3 usa 'paymentClient.cancel'
        const canceledPayment = await paymentClient.cancel({ id: invoice.mp_payment_id });
        console.log(`[MP Service] Pagamento cancelado no MP. Status: ${canceledPayment.status}`);
      } catch (error) {
        // Se o pagamento já expirou ou não pode ser cancelado, o MP dá erro
        console.warn(`⚠️ Alerta: Não foi possível cancelar a cobrança no MP. Detalhes: ${error.message}`);
        // Se o MP falhar, continuamos mesmo assim para cancelar localmente
      }
    }

    invoice.status = 'canceled';
    await invoice.save();

    console.log(`✅ Fatura [${invoice._id}] cancelada localmente.`);
    return invoice;
  }

  /**
   * Busca o status de um pagamento no Mercado Pago
   */
  async getMpPaymentStatus(paymentId) {
    try {
      console.log(`[MP Service] Consultando status do pagamento ID: ${paymentId}`);
      const paymentDetails = await paymentClient.get({ id: paymentId });
      return paymentDetails;
    } catch (error) {
      console.error(`❌ ERRO ao consultar o pagamento [${paymentId}] no MP:`);
      const errorData = error.cause?.data || error.response?.data || error.message;
      console.error(JSON.stringify(errorData, null, 2));
      throw new Error(`Falha ao buscar detalhes do pagamento no MP: ${error.message}`);
    }
  }

  // --- Funções CRUD Padrão ---

  async getAllInvoices() {
    return Invoice.find()
      .populate('student', 'fullName profilePicture')
      .populate('tutor', 'fullName');
  }

  async getInvoiceById(invoiceId) {
    return Invoice.findById(invoiceId)
      .populate('student', 'fullName profilePicture')
      .populate('tutor', 'fullName');
  }

  async getInvoicesByStudent(studentId) {
    return Invoice.find({ student: studentId })
      .sort({ dueDate: -1 })
      .populate('tutor', 'fullName');
  }

  // ==========================================================
  // INÍCIO DO MÉTODO PARA O ASSISTENTE GEMINI
  // ==========================================================
  
  /**
   * Encontra faturas vencidas e não pagas.
   * Chamado pelo AssistantService.
   */
  async findOverdue() {
    console.log(`[InvoiceService] Buscando faturas vencidas...`);
  
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Pega o início do dia de hoje
  
    // Query baseada nos status do seu invoice.model.js:
    // 1. Data de vencimento é ANTERIOR a hoje ($lt = less than)
    // 2. O status NÃO ESTÁ ($nin = not in) na lista de pagos ou cancelados
    //    (Isso pega 'pending' e 'overdue' que estão no passado)
    const query = {
      dueDate: { $lt: today },
      status: { $nin: ['paid', 'canceled'] } 
    };
  
    try {
      // .select() escolhe os campos e .lean() retorna JSON puro
      const invoices = await Invoice.find(query)
        .select('description value dueDate student') // Campos do seu model
        .populate('student', 'fullName') // Popula o nome do aluno
        .lean(); 
  
      console.log(`[InvoiceService] ${invoices.length} faturas vencidas encontradas.`);
      return invoices;
  
    } catch (error) {
      console.error('[InvoiceService] Erro ao buscar faturas vencidas:', error);
      throw new Error('Falha ao consultar banco de dados de faturas.');
    }
  }
  
  // ==========================================================
  // FIM DO MÉTODO PARA O ASSISTENTE GEMINI
  // ==========================================================
}

module.exports = new InvoiceService();