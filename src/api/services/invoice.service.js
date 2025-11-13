const Invoice = require('../models/invoice.model.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const { MercadoPagoConfig, Payment } = require('mercadopago');

require('dotenv').config();

// --- CONFIGURAÇÃO DE AMBIENTE ---
const isProduction = process.env.NODE_ENV === 'production';

const MP_ACCESS_TOKEN = isProduction 
 ? process.env.MP_ACCESS_TOKEN_PROD 
 : process.env.MP_ACCESS_TOKEN_TEST;

const NOTIFICATION_BASE_URL = isProduction 
 ? process.env.PROD_URL 
 : process.env.NGROK_URL;

if (!MP_ACCESS_TOKEN) throw new Error('MP_ACCESS_TOKEN não definido.');
if (!NOTIFICATION_BASE_URL) throw new Error('URL de notificação não definida.');

// Configuração SDK Mercado Pago
const client = new MercadoPagoConfig({
 accessToken: MP_ACCESS_TOKEN,
 options: { timeout: 5000 }
});
const paymentClient = new Payment(client);

class InvoiceService {
 
 /**
 * Cria fatura e gera PIX no MP
 */
 async createInvoice(invoiceData) {
  const { studentId, tutorId, value, dueDate, description } = invoiceData;

  const student = await Student.findById(studentId);
  if (!student) throw new Error('Aluno não encontrado');

  const tutor = await Tutor.findById(tutorId);
  if (!tutor) throw new Error('Tutor não encontrado');

  if (!tutor.cpf || tutor.cpf.length < 11) throw new Error('Tutor sem CPF válido.');
  if (!tutor.email) throw new Error('Tutor sem e-mail válido.');

  // Lógica de e-mail para Sandbox
  const payerEmail = isProduction ? tutor.email : "rianvitordev@gmail.com";

  // Conversão para Reais (ex: 200 centavos -> 2.00 reais)
  const valorEmReais = parseFloat((value / 100).toFixed(2));
  
  // Data de Vencimento (Final do dia)
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
    description,
    value: value, // Salva em centavos
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
   console.log(`✅ Fatura criada: ${newInvoice._id} (MP ID: ${paymentId})`);

   return await this.getInvoiceById(newInvoice._id);

  } catch (error) {
   console.error('❌ ERRO MP Create:', error);
   throw new Error(`Falha na criação da fatura: ${error.message}`);
  }
 }

 /**
 * Cancela uma fatura (MP e Local)
 */
 async cancelInvoice(invoiceId) {
  // 1. Busca e Valida
  const invoice = await this.getInvoiceById(invoiceId);
  if (!invoice) throw new Error('Fatura não encontrada');

  // Se já estiver cancelada, retorna ela mesma (Idempotência)
  if (invoice.status === 'canceled') {
   return invoice;
  }

  // Se já estiver paga, proíbe o cancelamento
  if (invoice.status === 'paid') {
   throw new Error('Não é possível cancelar uma fatura já PAGA.');
  }

  // 2. Tenta cancelar no Mercado Pago (se existir ID de pagamento)
  if (invoice.mp_payment_id) {
   try {
    console.log(`[MP Service] Cancelando pagamento ${invoice.mp_payment_id}...`);
    await paymentClient.cancel({ id: invoice.mp_payment_id });
    console.log('[MP Service] Cancelamento no MP efetuado.');
   } catch (error) {
    // Se der erro no MP (ex: pagamento não existe mais ou expirou), 
    // apenas logamos e continuamos para cancelar no nosso banco.
    console.warn(`⚠️ Aviso: Erro ao cancelar no MP (pode já estar expirado): ${error.message}`);
   }
  }

  // 3. Atualiza Localmente
  invoice.status = 'canceled';
  await invoice.save();

  console.log(`✅ Fatura ${invoice._id} marcada como CANCELADA.`);
  return invoice;
 }

 /**
 * Webhook Handler
 * [MODIFICADO] Agora retorna { processed: boolean } para o WebhookController.
 */
 async handlePaymentWebhook(paymentId) {
  console.log(`[InvoiceService] Verificando pagamento ${paymentId}...`);
  
  // 1. Busca a fatura no banco local
  const invoice = await Invoice.findOne({ mp_payment_id: paymentId });

  // [MODIFICAÇÃO CHAVE]
  // Se não encontrar, sinaliza ao WebhookController que não é dele.
  if (!invoice) {
   console.log(`[InvoiceService] Pagamento ${paymentId} não é uma fatura. Ignorando.`);
   return { processed: false };
  }

  // 2. Se encontrou, é dele. Continua o processo...
  console.log(`[InvoiceService] Fatura ${invoice._id} encontrada. Processando...`);
_  
  // Busca os detalhes do pagamento no MP
  let paymentDetails;
  try {
   paymentDetails = await this.getMpPaymentStatus(paymentId);
  } catch (error) {
   console.error(`[InvoiceService] Falha ao buscar detalhes do pagamento ${paymentId} no MP.`, error.message);
   // Retorna 'processed: true' mas sem status, para evitar re-processamento pelo WebhookController
   // A fatura existe, mas o MP falhou.
   return { processed: true, invoice: invoice, mpStatus: 'error_fetching' };
  }
  
  const mpStatus = paymentDetails.status;

  // 3. Mapeamento de status
  let novoStatus = invoice.status;
  if (mpStatus === 'approved' || mpStatus === 'authorized') novoStatus = 'paid';
  else if (mpStatus === 'pending') novoStatus = 'pending';
  else if (mpStatus === 'cancelled' || mpStatus === 'rejected') novoStatus = 'canceled';

  // 4. Atualiza o banco somente se houver mudança
  if (invoice.status !== novoStatus) {
   invoice.status = novoStatus;
   if (novoStatus === 'paid' && !invoice.paidAt) { // Só preenche a data se não tiver sido preenchida
    invoice.paidAt = new Date();
   }
   await invoice.save();
   console.log(`[InvoiceService] Status da fatura ${invoice._id} atualizado para: ${novoStatus}`);
  }
  
  // [MODIFICAÇÃO CHAVE]
  // Retorna o payload completo + a flag 'processed: true'
  return { 
   processed: true,
   invoice: await this.getInvoiceById(invoice.id), // Re-popula os dados para o emitter
   mpStatus 
  };
 }

 // --- Helpers ---

 async getMpPaymentStatus(paymentId) {
  try {
   // Nota: o SDK pode retornar o 'body' dentro de um wrapper
   const response = await paymentClient.get({ id: paymentId });
   return response; // O SDK v2/v3 geralmente retorna o corpo direto
  } catch (error) {
   console.error(`[MP Service] Erro ao buscar pagamento ${paymentId}:`, error);
   throw new Error(`Erro MP Get: ${error.message || 'Falha ao buscar dados no MP'}`);
  }
 }

 async getAllInvoices(filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;

  return Invoice.find(query)
   .sort({ dueDate: -1 }) // Mais recentes primeiro
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

 // Método para o Assistente (Gemini)
 async findOverdue() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return Invoice.find({
   dueDate: { $lt: today },
   status: { $nin: ['paid', 'canceled'] }
  })
  .select('description value dueDate student')
  .populate('student', 'fullName')
  .lean();

 }
}

module.exports = new InvoiceService();