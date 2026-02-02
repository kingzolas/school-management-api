// src/api/controllers/invoice.controller.js
const InvoiceService = require('../services/invoice.service');
const appEmitter = require('../../loaders/eventEmitter'); 

class InvoiceController {
  
  /**
   * Cria uma nova fatura (Gestor)
   */
  async create(req, res, next) {
    try {
      const schoolId = req.user.school_id;
      const newInvoice = await InvoiceService.createInvoice(req.body, schoolId);

      appEmitter.emit('invoice:created', newInvoice);
      
      res.status(201).json(newInvoice);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.create:', error.message);
      // Alterado de next(error) para res.status(400) para garantir que o front receba JSON
      res.status(400).json({ message: error.message || 'Erro desconhecido ao criar fatura.' });
    }
  }

  /**
   * [NOVO] Reenvia notificação via WhatsApp (Botão Manual)
   */
  async resendWhatsapp(req, res, next) {
    try {
      const schoolId = req.user.school_id;
      const { id } = req.params;

      // Chama o serviço. Se der erro lá, cai no catch abaixo.
      await InvoiceService.resendNotification(id, schoolId);

      // Se chegou aqui, é sucesso. O Flutter exibe o Toast positivo.
      return res.status(200).json({ 
        success: true, 
        message: 'Mensagem enviada com sucesso!' 
      });

    } catch (error) {
      console.error('❌ ERRO no InvoiceController.resendWhatsapp:', error.message);
      // Retorna erro para o Flutter exibir o Pop-up de Falha
      return res.status(400).json({ 
        success: false, 
        message: error.message || 'Falha ao enviar mensagem.'
      });
    }
  }

  /**
   * [NOVO] Sincroniza faturas pendentes e retorna estatísticas
   */
  async syncPending(req, res, next) {
    try {
      const schoolId = req.user.school_id;
      console.log(`🔄 [API] Sincronizando pendências para escola: ${schoolId}`);
      
      // Chama o serviço passando null no studentId para varrer a escola toda
      // Agora espera o retorno de 'stats'
      const stats = await InvoiceService.syncPendingInvoices(null, schoolId);
      
      console.log(`✅ [API] Sync Finalizado. Atualizados: ${stats.updatedCount} de ${stats.totalChecked}`);
      
      res.status(200).json({ 
          message: 'Sincronização realizada com sucesso.',
          stats: stats
      });

    } catch (error) {
      console.error('❌ ERRO no InvoiceController.syncPending:', error.message);
      // Não bloqueamos com erro 500 para não travar o app, apenas logamos
      res.status(500).json({ message: 'Erro interno na sincronização.', error: error.message });
    }
  }

  /**
   * Busca todas as faturas (da escola do Gestor)
   */
  async getAll(req, res, next) {
    try {
      const schoolId = req.user.school_id;
      const invoices = await InvoiceService.getAllInvoices(req.query, schoolId); 
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
      const schoolId = req.user.school_id;
      const studentId = req.params.studentId;
      const invoices = await InvoiceService.getInvoicesByStudent(studentId, schoolId); 
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
      const schoolId = req.user.school_id;
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
   * Cancela uma fatura
   */
  async cancel(req, res, next) {
    try {
      const schoolId = req.user.school_id;
      const { id } = req.params;
      
      const canceledInvoice = await InvoiceService.cancelInvoice(id, schoolId);

      appEmitter.emit('invoice:updated', canceledInvoice);

      res.status(200).json(canceledInvoice);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.cancel:', error.message);
      res.status(400).json({ message: error.message });
    }
  }

  /**
   * Consulta o status direto no Mercado Pago
   */
  async checkMpStatus(req, res, next) {
    try {
      const { paymentId } = req.params;
      const mpPaymentDetails = await InvoiceService.checkMpStatus(paymentId);
      res.status(200).json(mpPaymentDetails);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.checkMpStatus:', error.message);
      next(error);
    }
  }

  async batchPrint(req, res, next) {
    try {
      const schoolId = req.user.school_id;
      const { invoiceIds } = req.body;

      if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res.status(400).json({ message: 'Lista de faturas inválida.' });
      }

      const pdfBytes = await InvoiceService.generateBatchPdf(invoiceIds, schoolId);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename=carne_pagamento.pdf');
      
      res.send(Buffer.from(pdfBytes));

    } catch (error) {
      console.error('❌ ERRO no InvoiceController.batchPrint:', error.message);
      if (error.message.includes('Nenhuma fatura') || error.message.includes('acessíveis')) {
         return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  }
}

module.exports = new InvoiceController();