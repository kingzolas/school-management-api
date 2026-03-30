const NotificationService = require('../services/notification.service');
const Invoice = require('../models/invoice.model');
const WhatsappTransportLog = require('../models/whatsapp_transport_log.model');
const mongoose = require('mongoose');

class NotificationController {

  /**
   * GET /logs
   */
  async getLogs(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const { status, page, limit, date } = req.query;

      const result = await NotificationService.getLogs(
        schoolId,
        status,
        page,
        limit,
        date
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /retry-all
   */
  async retryAllFailed(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const { date } = req.query;

      const result = await NotificationService.retryAllFailed(schoolId, date);

      res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /stats
   */
  async getDashboardStats(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const { date } = req.query;

      const stats = await NotificationService.getDailyStats(schoolId, date);
      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /transport-logs
   * Ledger de transporte WhatsApp via Evolution.
   */
  async getTransportLogs(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const {
        status,
        providerStatus,
        providerMessageId,
        notificationLogId,
        invoiceId,
        destination,
        instanceName,
        source,
        page = 1,
        limit = 20,
      } = req.query;

      const filter = {
        school_id: schoolId,
      };

      if (status) filter.status = String(status).trim();
      if (providerStatus) filter.provider_status = String(providerStatus).trim().toUpperCase();
      if (providerMessageId) filter.provider_message_id = String(providerMessageId).trim();
      if (destination) filter.destination = String(destination).trim();
      if (instanceName) filter.instance_name = String(instanceName).trim();
      if (source) filter.source = String(source).trim();

      const metadataOr = [];

      if (notificationLogId) {
        const normalized = String(notificationLogId).trim();
        metadataOr.push({ 'metadata.notification_log_id': normalized });

        if (/^[a-f\d]{24}$/i.test(normalized)) {
          metadataOr.push({
            'metadata.notification_log_id': new mongoose.Types.ObjectId(normalized),
          });
        }
      }

      if (invoiceId) {
        const normalized = String(invoiceId).trim();
        metadataOr.push({ 'metadata.invoice_id': normalized });

        if (/^[a-f\d]{24}$/i.test(normalized)) {
          metadataOr.push({
            'metadata.invoice_id': new mongoose.Types.ObjectId(normalized),
          });
        }
      }

      if (metadataOr.length > 0) {
        filter.$or = metadataOr;
      }

      const safePage = Math.max(parseInt(page, 10) || 1, 1);
      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const skip = (safePage - 1) * safeLimit;

      const [logs, total] = await Promise.all([
        WhatsappTransportLog.find(filter)
          .sort({ last_event_at: -1, createdAt: -1 })
          .skip(skip)
          .limit(safeLimit)
          .lean(),
        WhatsappTransportLog.countDocuments(filter),
      ]);

      return res.status(200).json({
        logs,
        total,
        page: safePage,
        pages: Math.max(Math.ceil(total / safeLimit), 1),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /forecast
   */
  async getForecast(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      // O service interpreta YYYY-MM-DD como data local para evitar shift UTC.
      const forecast = await NotificationService.getForecast(schoolId, req.query.date);
      res.status(200).json(forecast);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /trigger
   * Gatilho Manual COMPLETO
   */
  async triggerManualRun(req, res, next) {
    try {
      console.log('⚡ [API] Trigger Manual acionado pelo painel...');
      await NotificationService.scanAndQueueInvoices({
        dispatchOrigin: 'manual_trigger',
      });
      NotificationService.processQueue();

      res.status(200).json({
        success: true,
        message: 'Varredura e processamento iniciados manualmente.'
      });
    } catch (error) {
      console.error("Erro no trigger:", error);
      next(error);
    }
  }

  /**
   * ✅ NOVO: POST /trigger-month
   * Aciona o envio de todos os boletos pendentes do MÊS atual
   */
  async triggerMonthInvoices(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const count = await NotificationService.queueMonthInvoicesManually(schoolId);
      
      // Inicia a fila logo em seguida
      NotificationService.processQueue();

      res.status(200).json({
        success: true,
        message: `${count} faturas do mês foram adicionadas à fila e começarão a ser enviadas.`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /enqueue
   * Reenfileirar manualmente UMA fatura (botão "Reenviar WhatsApp" no app)
   * Body: { invoiceId, type? }
   *
   * Regras:
   * - invoice deve existir, ser da escola
   * - invoice não pode estar paga/cancelada
   * - se estiver em HOLD (compensação ativa), NÃO enfileira
   */
  async enqueueInvoice(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const { invoiceId, type } = req.body;

      if (!invoiceId) {
        return res.status(400).json({ success: false, error: 'INVOICE_ID_REQUIRED' });
      }

      const inv = await Invoice.findOne({
        _id: invoiceId,
        school_id: schoolId
      }).populate('student').populate('tutor');

      if (!inv) {
        return res.status(404).json({ success: false, error: 'INVOICE_NOT_FOUND' });
      }

      if (inv.status === 'paid' || inv.status === 'canceled') {
        return res.status(400).json({ success: false, error: 'INVOICE_NOT_ELIGIBLE' });
      }

      // Bloqueio centralizado no service (HOLD)
      const result = await NotificationService.enqueueInvoiceManually({
        schoolId,
        invoice: inv,
        type: type || 'manual'
      });

      // result: { ok: true } ou { ok:false, reason:'HOLD_ACTIVE' ... }
      if (!result.ok) {
        return res.status(200).json({ success: false, ...result });
      }

      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /config
   */
  async getConfig(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const config = await NotificationService.getConfig(schoolId);
      res.status(200).json(config || {});
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /config
   */
  async saveConfig(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const config = await NotificationService.saveConfig(schoolId, req.body);
      res.status(200).json(config);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationController();
