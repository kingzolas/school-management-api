const NotificationTransportLog = require('../models/notification_transport_log.model');
const notificationLogService = require('./notificationLog.service');
const { normalizeWhatsappPhone } = require('../utils/timeContext');

const STATUS_RANK = Object.freeze({
  queued: 10,
  accepted: 20,
  sent: 30,
  failed: 35,
  delivered: 40,
  read: 50,
  bounced: 70,
  cancelled: 80,
});

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeEmail(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function toDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

class NotificationTransportLogService {
  constructor({
    NotificationTransportLogModel = NotificationTransportLog,
    notificationLogService: parentNotificationLogService = notificationLogService,
  } = {}) {
    this.NotificationTransportLogModel = NotificationTransportLogModel;
    this.notificationLogService = parentNotificationLogService;
  }

  async _getNextAttemptNumber(notificationLogId) {
    if (!notificationLogId) return 1;

    const latest = await this.NotificationTransportLogModel.findOne({
      notification_log_id: notificationLogId,
    })
      .sort({ attempt_number: -1 })
      .select('attempt_number')
      .lean();

    return Number(latest?.attempt_number || 0) + 1;
  }

  _pushHistory(attempt, entry) {
    if (!Array.isArray(attempt.status_history)) {
      attempt.status_history = [];
    }

    attempt.status_history.push(entry);

    if (attempt.status_history.length > 20) {
      attempt.status_history = attempt.status_history.slice(-20);
    }
  }

  _assignStageTimestamp(attempt, canonicalStatus, eventAt) {
    if (canonicalStatus === 'accepted' && !attempt.accepted_at) {
      attempt.accepted_at = eventAt;
    }

    if (canonicalStatus === 'sent' && !attempt.sent_at) {
      attempt.sent_at = eventAt;
    }

    if (canonicalStatus === 'delivered' && !attempt.delivered_at) {
      attempt.delivered_at = eventAt;
    }

    if (canonicalStatus === 'read' && !attempt.read_at) {
      attempt.read_at = eventAt;
    }

    if (canonicalStatus === 'failed' && !attempt.failed_at) {
      attempt.failed_at = eventAt;
    }

    if (canonicalStatus === 'cancelled' && !attempt.cancelled_at) {
      attempt.cancelled_at = eventAt;
    }
  }

  async _syncParentNotificationLog(attempt) {
    if (!attempt?.notification_log_id || !this.notificationLogService?.updateLogById) {
      return;
    }

    await this.notificationLogService.updateLogById(attempt.notification_log_id, {
      last_transport_log_id: attempt._id,
      last_transport_status: attempt.status || null,
      last_transport_canonical_status: attempt.canonical_status || null,
      attempts: Number(attempt.attempt_number || 1),
      provider: attempt.provider || null,
      delivery_channel: attempt.channel || null,
    });
  }

  async createAttempt({
    schoolId,
    notificationLogId = null,
    invoiceId = null,
    channel = 'whatsapp',
    provider = null,
    destination = null,
    destinationPhone = null,
    destinationEmail = null,
    requestKind = 'text',
    source = null,
    subject = null,
    bodyPreview = null,
    attachments = [],
    metadata = {},
    rawRequestPayload = null,
  } = {}) {
    const attemptNumber = await this._getNextAttemptNumber(notificationLogId);
    const now = new Date();

    const attempt = await this.NotificationTransportLogModel.create({
      school_id: schoolId,
      notification_log_id: notificationLogId,
      invoice_id: invoiceId,
      attempt_number: attemptNumber,
      channel,
      provider,
      destination,
      destination_phone: destinationPhone,
      destination_phone_normalized: destinationPhone ? normalizeWhatsappPhone(destinationPhone) || null : null,
      destination_email: destinationEmail,
      destination_email_normalized: destinationEmail ? normalizeEmail(destinationEmail) : null,
      request_kind: requestKind,
      source,
      subject,
      body_preview: bodyPreview,
      attachments,
      queued_at: now,
      last_event_at: now,
      last_event_type: 'ATTEMPT_CREATED',
      status: 'queued',
      canonical_status: 'queued',
      status_rank: STATUS_RANK.queued,
      raw_request_payload: rawRequestPayload,
      metadata,
      status_history: [{
        event_type: 'ATTEMPT_CREATED',
        canonical_status: 'queued',
        provider_status: null,
        occurred_at: now,
        raw_payload: rawRequestPayload,
        source,
        metadata,
      }],
    });

    await this._syncParentNotificationLog(attempt);
    return attempt;
  }

  async _transitionAttempt(attemptId, {
    status,
    canonicalStatus,
    providerStatus = null,
    providerMessageId = null,
    providerThreadId = null,
    eventAt = new Date(),
    eventType = null,
    rawProviderResponse = null,
    rawLastWebhookPayload = null,
    rawLastError = null,
    source = null,
    metadata = {},
    errorMessage = null,
    errorCode = null,
    errorHttpStatus = null,
    destination = null,
    destinationPhone = null,
    destinationEmail = null,
    instanceName = null,
    instanceId = null,
    remoteJid = null,
  } = {}) {
    const attempt = await this.NotificationTransportLogModel.findById(attemptId);
    if (!attempt) {
      throw new Error('NOTIFICATION_TRANSPORT_ATTEMPT_NOT_FOUND');
    }

    const nextCanonicalStatus = normalizeString(canonicalStatus || status) || 'queued';
    const currentRank = STATUS_RANK[attempt.canonical_status] || 0;
    const nextRank = STATUS_RANK[nextCanonicalStatus] || 0;
    const finalEventAt = toDate(eventAt);

    if (providerMessageId) attempt.provider_message_id = normalizeString(providerMessageId);
    if (providerThreadId) attempt.provider_thread_id = normalizeString(providerThreadId);
    if (providerStatus) attempt.provider_status = normalizeString(providerStatus);
    if (destination) attempt.destination = normalizeString(destination);
    if (destinationPhone) {
      attempt.destination_phone = normalizeString(destinationPhone);
      attempt.destination_phone_normalized = normalizeWhatsappPhone(destinationPhone) || null;
    }
    if (destinationEmail) {
      attempt.destination_email = normalizeEmail(destinationEmail);
      attempt.destination_email_normalized = normalizeEmail(destinationEmail);
    }
    if (instanceName) attempt.instance_name = normalizeString(instanceName);
    if (instanceId) attempt.instance_id = normalizeString(instanceId);
    if (remoteJid) attempt.remote_jid = normalizeString(remoteJid);

    if (nextRank >= currentRank) {
      attempt.canonical_status = nextCanonicalStatus;
      attempt.status = normalizeString(status) || nextCanonicalStatus;
      attempt.status_rank = nextRank;
      this._assignStageTimestamp(attempt, nextCanonicalStatus, finalEventAt);
    }

    attempt.last_event_at = finalEventAt;
    attempt.last_event_type = normalizeString(eventType) || nextCanonicalStatus.toUpperCase();

    if (rawProviderResponse !== null) {
      attempt.raw_provider_response = rawProviderResponse;
    }

    if (rawLastWebhookPayload !== null) {
      attempt.raw_last_webhook_payload = rawLastWebhookPayload;
    }

    if (rawLastError !== null) {
      attempt.raw_last_error = rawLastError;
    }

    if (errorMessage !== null) attempt.error_message = errorMessage;
    if (errorCode !== null) attempt.error_code = errorCode;
    if (errorHttpStatus !== null) attempt.error_http_status = errorHttpStatus;

    this._pushHistory(attempt, {
      event_type: attempt.last_event_type,
      canonical_status: nextCanonicalStatus,
      provider_status: normalizeString(providerStatus),
      occurred_at: finalEventAt,
      raw_payload: rawLastWebhookPayload ?? rawProviderResponse ?? rawLastError ?? null,
      source,
      metadata,
      error_message: errorMessage,
      error_code: errorCode,
      error_http_status: errorHttpStatus,
    });

    await attempt.save();
    await this._syncParentNotificationLog(attempt);

    return attempt;
  }

  async markAccepted(attemptId, input = {}) {
    return this._transitionAttempt(attemptId, {
      ...input,
      status: input.status || 'accepted',
      canonicalStatus: 'accepted',
      eventType: input.eventType || 'ATTEMPT_ACCEPTED',
    });
  }

  async markSent(attemptId, input = {}) {
    return this._transitionAttempt(attemptId, {
      ...input,
      status: input.status || 'sent',
      canonicalStatus: 'sent',
      eventType: input.eventType || 'ATTEMPT_SENT',
    });
  }

  async markDelivered(attemptId, input = {}) {
    return this._transitionAttempt(attemptId, {
      ...input,
      status: input.status || 'delivered',
      canonicalStatus: 'delivered',
      eventType: input.eventType || 'ATTEMPT_DELIVERED',
    });
  }

  async markRead(attemptId, input = {}) {
    return this._transitionAttempt(attemptId, {
      ...input,
      status: input.status || 'read',
      canonicalStatus: 'read',
      eventType: input.eventType || 'ATTEMPT_READ',
    });
  }

  async markFailed(attemptId, input = {}) {
    return this._transitionAttempt(attemptId, {
      ...input,
      status: input.status || 'failed',
      canonicalStatus: 'failed',
      eventType: input.eventType || 'ATTEMPT_FAILED',
    });
  }

  async markCancelled(attemptId, input = {}) {
    return this._transitionAttempt(attemptId, {
      ...input,
      status: input.status || 'cancelled',
      canonicalStatus: 'cancelled',
      eventType: input.eventType || 'ATTEMPT_CANCELLED',
    });
  }
}

const service = new NotificationTransportLogService();

module.exports = service;
module.exports.NotificationTransportLogService = NotificationTransportLogService;
