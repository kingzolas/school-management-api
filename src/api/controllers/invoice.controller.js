// src/api/controllers/invoice.controller.js
const InvoiceService = require('../services/invoice.service');
const appEmitter = require('../../loaders/eventEmitter');

// ================================
// [NOVO] Model de compensação
// ================================
const InvoiceCompensation = require('../models/invoice_compensation.model');

// ================================
// [NOVO] Helper: Enriquecer invoices com campos de compensação
// - NÃO altera status
// - NÃO altera nada na Cora
// - Só adiciona collection_status e compensation na resposta
// ================================
async function attachCompensationFields({ school_id, invoices }) {
  if (!invoices || !Array.isArray(invoices) || invoices.length === 0) return invoices;

  const ids = invoices
    .map((inv) => (inv && inv._id ? inv._id : null))
    .filter(Boolean);

  if (ids.length === 0) return invoices;

  const comps = await InvoiceCompensation.find({
    school_id,
    status: 'active',
    target_invoice: { $in: ids },
  })
    .populate('source_invoice', 'description dueDate status value paidAt')
    .select('reason notes createdAt target_invoice source_invoice');

  const map = new Map();
  comps.forEach((c) => map.set(String(c.target_invoice), c));

  return invoices.map((inv) => {
    const obj = inv && inv.toObject ? inv.toObject() : inv;

    const comp = map.get(String(inv._id));
    const isPendingLike = obj.status === 'pending' || obj.status === 'overdue';

    return {
      ...obj,
      collection_status: isPendingLike && comp ? 'compensation_hold' : 'collectable',
      compensation: comp
        ? {
            id: comp._id,
            reason: comp.reason,
            notes: comp.notes,
            createdAt: comp.createdAt,
            source_invoice: comp.source_invoice,
          }
        : null,
    };
  });
}

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
      // Retornando 400 com JSON garantido para o Frontend ler 'errorJson["message"]'
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
        message: 'Mensagem enviada com sucesso!',
      });
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.resendWhatsapp:', error.message);
      // Retorna erro para o Flutter exibir o Pop-up de Falha
      return res.status(400).json({
        success: false,
        message: error.message || 'Falha ao enviar mensagem.',
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
        stats: stats,
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

      // ================================
      // [NOVO] Enriquecimento com compensação
      // ================================
      const enriched = await attachCompensationFields({ school_id: schoolId, invoices });

      res.status(200).json(enriched);
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

      // ================================
      // [NOVO] Enriquecimento com compensação
      // ================================
      const enriched = await attachCompensationFields({ school_id: schoolId, invoices });

      res.status(200).json(enriched);
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

      // ================================
      // [NOVO] Enriquecimento (single)
      // ================================
      const enrichedArr = await attachCompensationFields({ school_id: schoolId, invoices: [invoice] });
      const enriched = enrichedArr && enrichedArr.length ? enrichedArr[0] : invoice;

      res.status(200).json(enriched);
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

  /**
   * ✅ DEBUG (TEMPORÁRIO)
   * Consulta um boleto/fatura diretamente na Cora pelo external_id.
   */
  async debugCora(req, res) {
    try {
      const schoolId = req.user.school_id;
      const { externalId } = req.params;

      const data = await InvoiceService.debugCoraInvoice(externalId, schoolId);
      return res.status(200).json(data);
    } catch (error) {
      console.error('❌ ERRO no InvoiceController.debugCora:', error.message);
      return res.status(400).json({
        ok: false,
        message: error.message || 'Falha ao consultar a Cora.',
      });
    }
  }
}

module.exports = new InvoiceController();