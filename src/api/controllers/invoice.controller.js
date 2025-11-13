const InvoiceService = require('../services/invoice.service');
const appEmitter = require('../../loaders/eventEmitter'); 

class InvoiceController {
  
  /**
   * Cria uma nova fatura
   */
  async create(req, res, next) {
    try {
      const newInvoice = await InvoiceService.createInvoice(req.body);

      // Emite evento via WebSocket
      appEmitter.emit('invoice:created', newInvoice);
      
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
      // Passa query params se houver (ex: ?status=pending)
      const invoices = await InvoiceService.getAllInvoices(req.query);
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
   * Busca uma fatura específica por ID
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
   * Cancela uma fatura
   */
  async cancel(req, res, next) {
    try {
      const { id } = req.params;
      
      // Chama o serviço para cancelar
      const canceledInvoice = await InvoiceService.cancelInvoice(id);

      // Emite o evento de atualização para o WebSocket
      // O app Flutter ouvirá isso e atualizará a tela em tempo real também
      appEmitter.emit('invoice:updated', canceledInvoice);
      console.log(`📡 EVENTO EMITIDO: invoice:updated (cancelada ID: ${id})`);

      res.status(200).json(canceledInvoice);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.cancel:', error.message);
      // Retorna erro 400 para erros de negócio (ex: tentar cancelar fatura paga)
      res.status(400).json({ message: error.message });
    }
  }

  /**
   * Consulta o status direto no Mercado Pago
   */
  async checkMpStatus(req, res, next) {
    try {
      const { paymentId } = req.params;
      const mpPaymentDetails = await InvoiceService.getMpPaymentStatus(paymentId);
      res.status(200).json(mpPaymentDetails);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.checkMpStatus:', error.message);
      next(error);
    }
  }
}

module.exports = new InvoiceController();