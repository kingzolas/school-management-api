// src/api/controllers/invoice.controller.js
const InvoiceService = require('../services/invoice.service');
const appEmitter = require('../../loaders/eventEmitter'); 

class InvoiceController {
  
  /**
    * Cria uma nova fatura (Gestor)
    */
  async create(req, res, next) {
    try {
      const schoolId = req.user.school_id; // [NOVO] Pega o ID da escola
      
      // [MODIFICADO] Passa o schoolId para o Service
      const newInvoice = await InvoiceService.createInvoice(req.body, schoolId);

      appEmitter.emit('invoice:created', newInvoice);
      
      res.status(201).json(newInvoice);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.create:', error.message);
      next(error);
    }
  }

  /**
    * Busca todas as faturas (da escola do Gestor)
    */
  async getAll(req, res, next) {
    try {
      const schoolId = req.user.school_id; // [NOVO] Pega o ID da escola
      // [MODIFICADO] Passa o schoolId para o Service
      const invoices = await InvoiceService.getAllInvoices(req.query, schoolId); 
      res.status(200).json(invoices);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.getAll:', error.message);
      next(error);
    }
  }

  /**
    * Busca faturas de um aluno específico (da escola do Gestor)
    */
  async getByStudent(req, res, next) {
    try {
      const schoolId = req.user.school_id; // [NOVO] Pega o ID da escola
      const studentId = req.params.studentId;
      // [MODIFICADO] Passa o schoolId para o Service
      const invoices = await InvoiceService.getInvoicesByStudent(studentId, schoolId); 
      res.status(200).json(invoices);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.getByStudent:', error.message);
      next(error);
    }
  }

  /**
    * Busca uma fatura específica por ID (da escola do Gestor)
    */
  async getById(req, res, next) {
    try {
      const schoolId = req.user.school_id; // [NOVO] Pega o ID da escola
      // [MODIFICADO] Passa o schoolId para o Service
      const invoice = await InvoiceService.getInvoiceById(req.params.id, schoolId); 
      
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
    * Cancela uma fatura (da escola do Gestor)
    */
  async cancel(req, res, next) {
    try {
      const schoolId = req.user.school_id; // [NOVO] Pega o ID da escola
      const { id } = req.params;
      
      // [MODIFICADO] Passa o schoolId para o Service
      const canceledInvoice = await InvoiceService.cancelInvoice(id, schoolId);

      appEmitter.emit('invoice:updated', canceledInvoice);

      res.status(200).json(canceledInvoice);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.cancel:', error.message);
      res.status(400).json({ message: error.message });
    }
  }

  /**
    * Consulta o status direto no Mercado Pago (Não precisa de schoolId)
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