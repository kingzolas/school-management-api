const NotificationService = require('../services/notification.service');
const AppNotificationService = require('../services/appNotification.service');
const Invoice = require('../models/invoice.model');
const {
  buildOutcomePayload,
  getOutcomeDescriptor,
  mapDispatchErrorCode,
} = require('../utils/notificationOutcome.util');

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

function buildBackgroundBatchResponse({
  code,
  message,
  snapshot,
  started,
  alreadyRunning,
  startedAt,
}) {
  const descriptor = getOutcomeDescriptor(code);
  return {
    success: true,
    has_failures: false,
    total_analisado: 0,
    total_elegivel: 0,
    total_queued: snapshot?.queued || 0,
    total_paused: snapshot?.paused || 0,
    total_skipped: 0,
    total_failed: 0,
    total_cancelled: 0,
    total_already_processed: 0,
    total_untouched: 0,
    breakdown: {},
    items: [],
    code,
    category: descriptor.category,
    title: descriptor.title,
    user_message: descriptor.user_message,
    background_started: started === true,
    already_running: alreadyRunning === true,
    processing_started_at: startedAt || null,
    queue_snapshot: snapshot || { queued: 0, processing: 0, paused: 0 },
    message,
  };
}

class NotificationController {
  async listAppNotifications(req, res) {
    try {
      const result = await AppNotificationService.listForViewer(
        req.notificationViewer,
        req.query
      );
      res.status(200).json(result);
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Falha ao buscar notificações.' });
    }
  }

  async markAppNotificationRead(req, res) {
    try {
      const item = await AppNotificationService.markAsRead(
        req.params.id,
        req.notificationViewer
      );

      if (!item) {
        return res.status(404).json({ message: 'Notificação não encontrada.' });
      }

      res.status(200).json(item);
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Falha ao marcar notificação como lida.' });
    }
  }

  async markAllAppNotificationsRead(req, res) {
    try {
      const result = await AppNotificationService.markAllAsRead(
        req.notificationViewer,
        req.body || {}
      );
      res.status(200).json(result);
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || 'Falha ao marcar notificações como lidas.' });
    }
  }

  async getLogs(req, res) {
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

  async retryAllFailed(req, res) {
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

  async clearQueue(req, res) {
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

  async getDashboardStats(req, res) {
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

  async getTransportLogs(req, res) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const result = await NotificationService.getTransportLogs(schoolId, req.query);
      return res.status(200).json(result);
    } catch (error) {
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }

  async getForecast(req, res) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const forecast = await NotificationService.getForecast(schoolId, req.query.date);
      res.status(200).json(forecast);
    } catch (error) {
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }

  async triggerManualRun(req, res) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const trigger = await NotificationService.triggerQueueProcessingInBackground(schoolId);
      const code = trigger.alreadyRunning
        ? 'QUEUE_PROCESS_ALREADY_RUNNING'
        : 'QUEUE_PROCESS_STARTED';

      res.status(200).json(
        buildBackgroundBatchResponse({
          code,
          message: trigger.alreadyRunning
            ? 'O processamento da fila ja esta em andamento em segundo plano.'
            : 'O processamento da fila foi iniciado em segundo plano.',
          snapshot: trigger.snapshot,
          started: trigger.started,
          alreadyRunning: trigger.alreadyRunning,
          startedAt: trigger.startedAt,
        })
      );
    } catch (error) {
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }

  async triggerMonthInvoices(req, res) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const trigger = await NotificationService.triggerMonthReleaseInBackground(schoolId);
      const code = trigger.alreadyRunning
        ? 'MONTH_RELEASE_ALREADY_RUNNING'
        : 'MONTH_RELEASE_STARTED';

      res.status(200).json(
        buildBackgroundBatchResponse({
          code,
          message: trigger.alreadyRunning
            ? 'A liberacao dos boletos do mes ja esta em andamento em segundo plano.'
            : 'A liberacao dos boletos do mes foi iniciada em segundo plano.',
          snapshot: trigger.snapshot,
          started: trigger.started,
          alreadyRunning: trigger.alreadyRunning,
          startedAt: trigger.startedAt,
        })
      );
    } catch (error) {
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }

  async enqueueInvoice(req, res) {
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

  async getConfig(req, res) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const config = await NotificationService.getConfig(schoolId);
      res.status(200).json(config || {});
    } catch (error) {
      const payload = buildControllerErrorPayload(error);
      res.status(resolveOutcomeHttpStatus(payload)).json(payload);
    }
  }

  async saveConfig(req, res) {
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
