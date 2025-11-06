const InvoiceService = require('../services/invoice.service');
const appEmitter = require('../../loaders/eventEmitter'); // Assumindo o caminho do seu emitter

class InvoiceController {
  /**
   * Cria uma nova fatura (agora no Mercado Pago)
   */
  async create(req, res, next) {
    try {
      // O InvoiceService.createInvoice agora tem toda a lógica do MP
      const newInvoice = await InvoiceService.createInvoice(req.body);

      // Emite o evento para o WebSocket
      appEmitter.emit('invoice:created', newInvoice);
      console.log(`📡 EVENTO EMITIDO: invoice:created`);

      res.status(201).json(newInvoice);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.create:', error.message);
      next(error);
    }
  }

  /**
   * Busca todas as faturas
   */
  async getAll(req, res, next) {
    try {
      const invoices = await InvoiceService.getAllInvoices();
      res.status(200).json(invoices);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.getAll:', error.message);
      next(error);
    }
  }

  /**
   * Busca faturas de um aluno específico
   */
  async getByStudent(req, res, next) {
    try {
      const studentId = req.params.studentId;
      const invoices = await InvoiceService.getInvoicesByStudent(studentId);
      res.status(200).json(invoices);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.getByStudent:', error.message);
      next(error);
    }
  }

  /**
   * Busca uma fatura específica por ID do *nosso* banco
   */
  async getById(req, res, next) {
    try {
      const invoice = await InvoiceService.getInvoiceById(req.params.id);
      if (!invoice) {
        return res.status(404).json({ message: 'Fatura não encontrada' });
      }
      res.status(200).json(invoice);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.getById:', error.message);
      next(error);
    }
  }

  /**
   * Cancela uma fatura (localmente e no MP)
   */
  async cancel(req, res, next) {
    try {
      const { id } = req.params;
      const canceledInvoice = await InvoiceService.cancelInvoice(id);

      // Emite o evento de atualização para o WebSocket
      appEmitter.emit('invoice:updated', canceledInvoice);
      console.log(`📡 EVENTO EMITIDO: invoice:updated (cancelada)`);

      res.status(200).json(canceledInvoice);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.cancel:', error.message);
      next(error);
    }
  }

  // --- NOVA FUNÇÃO PARA MERCADO PAGO ---
  /**
   * Consulta o status de um pagamento diretamente no Mercado Pago.
   * Rota: GET /api/invoices/mp/:paymentId
   */
  async checkMpStatus(req, res, next) {
    try {
      const { paymentId } = req.params;
      console.log(`[Controller] Consultando status no MP para o paymentId: ${paymentId}`);
      
      // O InvoiceService.getMpPaymentStatus foi criado para isso
      const mpPaymentDetails = await InvoiceService.getMpPaymentStatus(paymentId);
      
      // Retorna o JSON completo do Mercado Pago
      res.status(200).json(mpPaymentDetails);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.checkMpStatus:', error.message);
      next(error);
    }
  }
}

module.exports = new InvoiceController();