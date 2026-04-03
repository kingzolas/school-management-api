const NotificationService = require('../services/notification.service');
const Invoice = require('../models/invoice.model');
const { buildOutcomePayload, getOutcomeDescriptor, mapDispatchErrorCode } = require('../utils/notificationOutcome.util');

function buildControllerErrorPayload(error, fallbackCode = 'INTERNAL_ERROR') {
  const code = mapDispatchErrorCode(error, null) || error?.code || fallbackCode;
  return buildOutcomePayload({
    code,
    status: 'failed',
    technicalMessage: error?.message || null,
  });
}

function resolveOutcomeHttpStatus(payload) {
  if (!payload || payload.status !== 'failed') return 200;
  return getOutcomeDescriptor(payload.code || 'INTERNAL_ERROR').httpStatus || 500;
}

class NotificationController {

  /**
   * GET /logs
   */
  async getLogs(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const { status, page, limit, date, scope } = req.query;

      const result = await NotificationService.getLogs(
        schoolId,
        status,
        page,
        limit,
        date,
        { scope }
      );

      res.status(200).json(result);
    } catch (error) {
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
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
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }

  /**
   * POST /clear-queue
   */
  async clearQueue(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const result = await NotificationService.clearPendingQueue(schoolId, {
        cancelledByAction: 'queue_clear',
        cancelledReason: 'manual_queue_reset_before_email_rollout',
      });

      res.status(200).json(result);
    } catch (error) {
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
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
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }

  /**
   * GET /transport-logs
   * Ledger de transporte WhatsApp via Evolution.
   */
  async getTransportLogs(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const result = await NotificationService.getTransportLogs(schoolId, req.query);
      return res.status(200).json(result);
    } catch (error) {
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
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
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }

  /**
   * POST /trigger
   * Gatilho Manual COMPLETO
   */
  async triggerManualRun(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;

      console.log('[API] Trigger Manual acionado pelo painel...');

      const result = await NotificationService.scanAndQueueInvoices({
        schoolId,
        dispatchOrigin: 'manual_trigger',
        collectResults: true,
      });

      if (result.total_queued > 0) {
        NotificationService.processQueue({ schoolId });
      }

      res.status(200).json({
        ...result,
        message: result.total_queued > 0
          ? 'Varredura concluÃ­da e itens elegÃ­veis adicionados Ã  fila.'
          : 'Varredura concluÃ­da sem novos itens elegÃ­veis para envio.',
      });
    } catch (error) {
      console.error('Erro no trigger:', error);
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }

  /**
   * POST /trigger-month
   * Aciona o envio de todos os boletos pendentes do mes atual
   */
  async triggerMonthInvoices(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const result = await NotificationService.queueMonthInvoicesManually(schoolId);

      if (result.total_queued > 0) {
        NotificationService.processQueue({ schoolId });
      }

      res.status(200).json({
        ...result,
        message: result.total_queued > 0
          ? `${result.total_queued} cobranÃ§a(s) do mÃªs foram adicionadas Ã  fila.`
          : 'Nenhuma cobranÃ§a elegÃ­vel foi adicionada Ã  fila neste mÃªs.',
      });
    } catch (error) {
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }

  /**
   * POST /enqueue
   * Reenfileirar manualmente UMA fatura (botao "Reenviar WhatsApp" no app)
   * Body: { invoiceId, type? }
   *
   * Regras:
   * - invoice deve existir, ser da escola
   * - invoice nao pode estar paga/cancelada
   * - se estiver em HOLD (compensacao ativa), NAO enfileira
   */
  async enqueueInvoice(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const { invoiceId, type } = req.body;

      if (!invoiceId) {
        const payload = buildOutcomePayload({
          code: 'INVOICE_ID_REQUIRED',
          status: 'failed',
          technicalMessage: 'invoiceId nao informado no body.',
        });
        return res.status(400).json(payload);
      }

      const inv = await Invoice.findOne({
        _id: invoiceId,
        school_id: schoolId,
      }).populate('student').populate('tutor');

      if (!inv) {
        const payload = buildOutcomePayload({
          code: 'INVOICE_NOT_FOUND',
          status: 'failed',
          technicalMessage: 'Invoice nao encontrada para reenfileiramento manual.',
          invoiceId,
          itemId: invoiceId,
        });
        return res.status(404).json(payload);
      }

      const result = await NotificationService.enqueueInvoiceManually({
        schoolId,
        invoice: inv,
        type: type || 'manual',
        processNow: true,
      });

      return res.status(resolveOutcomeHttpStatus(result)).json(result);
    } catch (error) {
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
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
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
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
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }
}

module.exports = new NotificationController();
