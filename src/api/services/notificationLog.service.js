const { v4: uuidv4 } = require('uuid');

const NotificationLog = require('../models/notification-log.model');
const { DEFAULT_TIME_ZONE, getBusinessDayRange, normalizeWhatsappPhone } = require('../utils/timeContext');
const { getOutcomeDescriptor } = require('../utils/notificationOutcome.util');

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeEmail(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function toPlainObject(value) {
  if (!value || typeof value !== 'object') return value;
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
}

class NotificationLogService {
  constructor({ NotificationLogModel = NotificationLog, timeZone = DEFAULT_TIME_ZONE } = {}) {
    this.NotificationLogModel = NotificationLogModel;
    this.businessTimeZone = timeZone;
  }

  _getBusinessDayContext(date = new Date()) {
    return getBusinessDayRange(date, this.businessTimeZone);
  }

  _normalizePhone(phone) {
    return normalizeWhatsappPhone(phone);
  }

  _blocksSameDayDuplicate(log = {}) {
    return new Set(['queued', 'processing', 'sent']).has(
      String(log?.status || '').toLowerCase()
    );
  }

  buildDeliveryKey({
    schoolId,
    invoiceId,
    channel = 'whatsapp',
    phone = null,
    email = null,
    businessDay = null,
  }) {
    const normalizedPhone = this._normalizePhone(phone);
    const normalizedEmail = normalizeEmail(email);

    const destinationKey = channel === 'email'
      ? (normalizedEmail || 'no-email')
      : (normalizedPhone || normalizeString(phone) || 'no-phone');

    return [
      String(schoolId || '').trim(),
      String(invoiceId || '').trim(),
      String(channel || 'whatsapp').trim(),
      destinationKey,
      String(businessDay || '').trim(),
    ].join(':');
  }

  buildOutcomeDeliveryKey({
    schoolId,
    invoiceId,
    channel = 'whatsapp',
    phone = null,
    email = null,
    businessDay = null,
    outcomeCode = null,
    dispatchOrigin = 'manual_queue',
  }) {
    return [
      this.buildDeliveryKey({
        schoolId,
        invoiceId,
        channel,
        phone,
        email,
        businessDay,
      }),
      'outcome',
      normalizeString(outcomeCode) || 'UNKNOWN',
      normalizeString(dispatchOrigin) || 'manual_queue',
    ].join(':');
  }

  resolveRecipient(logLike = {}) {
    const plain = toPlainObject(logLike) || {};
    const snapshot = plain.recipient_snapshot && typeof plain.recipient_snapshot === 'object'
      ? plain.recipient_snapshot
      : {};

    const targetPhone = normalizeString(
      snapshot.phone ||
      snapshot.phone_normalized ||
      plain.target_phone_normalized ||
      plain.target_phone
    );

    const normalizedPhone = targetPhone ? this._normalizePhone(targetPhone) || null : null;
    const targetEmail = normalizeEmail(
      snapshot.email ||
      snapshot.email_normalized ||
      plain.target_email_normalized ||
      plain.target_email
    );

    const recipientRole = normalizeString(snapshot.role || plain.recipient_role) || 'unknown';
    const recipientName = normalizeString(snapshot.name || plain.recipient_name || plain.tutor_name || plain.student_name);

    return {
      recipient_role: recipientRole,
      recipient_student_id: snapshot.student_id || plain.recipient_student_id || plain?.invoice_snapshot?.student || null,
      recipient_tutor_id: snapshot.tutor_id || plain.recipient_tutor_id || plain?.invoice_snapshot?.tutor || null,
      recipient_name: recipientName,
      student_name: normalizeString(plain.student_name),
      tutor_name: normalizeString(plain.tutor_name),
      target_phone: normalizeString(targetPhone),
      target_phone_normalized: normalizedPhone,
      target_email: targetEmail,
      target_email_normalized: targetEmail,
      recipient_snapshot: this.NotificationLogModel.buildMinimalRecipientSnapshot({
        ...plain,
        recipient_name: recipientName,
        recipient_role: recipientRole,
        target_phone: normalizeString(targetPhone),
        target_phone_normalized: normalizedPhone,
        target_email: targetEmail,
        target_email_normalized: targetEmail,
      }),
    };
  }

  async findExistingLogForDay({
    schoolId,
    invoiceId,
    channel = 'whatsapp',
    phone = null,
    email = null,
    referenceDate = new Date(),
  }) {
    const { startOfDay, endOfDay, businessDayKey, timeZone } = this._getBusinessDayContext(referenceDate);
    const normalizedPhone = phone ? this._normalizePhone(phone) || null : null;
    const normalizedEmail = email ? normalizeEmail(email) : null;
    const deliveryKey = this.buildDeliveryKey({
      schoolId,
      invoiceId,
      channel,
      phone: normalizedPhone,
      email: normalizedEmail,
      businessDay: businessDayKey,
    });

    const logs = await this.NotificationLogModel.find({
      school_id: schoolId,
      invoice_id: invoiceId,
      $or: [
        { business_day: businessDayKey },
        { createdAt: { $gte: startOfDay, $lte: endOfDay } },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    const existing = logs.find((log) => {
      if (!this._blocksSameDayDuplicate(log)) {
        return false;
      }

      const resolved = this.resolveRecipient(log);

      if (channel && log?.delivery_channel && String(log.delivery_channel) !== String(channel)) {
        return false;
      }

      if (channel === 'email') {
        if (normalizedEmail && resolved.target_email_normalized !== normalizedEmail) return false;
        if (!normalizedEmail && resolved.target_email_normalized) return false;
        return true;
      }

      if (normalizedPhone && resolved.target_phone_normalized !== normalizedPhone) return false;
      if (!normalizedPhone && resolved.target_phone_normalized) return false;
      return true;
    });

    return {
      existing: existing || null,
      deliveryKey,
      normalizedPhone,
      normalizedEmail,
      businessDay: businessDayKey,
      businessTimeZone: timeZone,
      startOfDay,
      endOfDay,
    };
  }

  async findExistingOutcomeLogForDay({
    schoolId,
    invoiceId,
    channel = 'whatsapp',
    outcomeCode = null,
    status = 'skipped',
    dispatchOrigin = 'manual_queue',
    referenceDate = new Date(),
  }) {
    const { startOfDay, endOfDay, businessDayKey } = this._getBusinessDayContext(referenceDate);
    const existing = await this.NotificationLogModel.findOne({
      school_id: schoolId,
      invoice_id: invoiceId,
      status,
      delivery_channel: channel,
      dispatch_origin: dispatchOrigin,
      outcome_code: outcomeCode,
      $or: [
        { business_day: businessDayKey },
        { createdAt: { $gte: startOfDay, $lte: endOfDay } },
      ],
    }).lean();

    return {
      existing: existing || null,
      businessDay: businessDayKey,
      businessTimeZone: this.businessTimeZone,
      startOfDay,
      endOfDay,
    };
  }

  async findLatestSuccessfulLogForInvoice({
    schoolId,
    invoiceId,
    channel = 'email',
  }) {
    return this.NotificationLogModel.findOne({
      school_id: schoolId,
      invoice_id: invoiceId,
      delivery_channel: channel,
      status: 'sent',
      sent_at: { $ne: null },
      last_transport_canonical_status: { $nin: ['failed', 'bounced', 'cancelled'] },
    })
      .sort({ sent_at: -1, createdAt: -1 })
      .lean();
  }

  buildOutcomeMetadata(outcome = {}) {
    const descriptor = outcome?.code
      ? getOutcomeDescriptor(outcome.code)
      : null;

    return {
      outcome_code: outcome?.code || null,
      outcome_category: outcome?.category || descriptor?.category || null,
      outcome_title: outcome?.title || descriptor?.title || null,
      outcome_user_message: outcome?.user_message || descriptor?.user_message || null,
      outcome_retryable: outcome?.retryable ?? descriptor?.retryable ?? null,
      outcome_field: outcome?.field || descriptor?.field || null,
    };
  }

  buildCreatePayload({
    schoolId,
    invoiceId,
    recipient = {},
    type = 'new_invoice',
    status = 'queued',
    scheduledFor = new Date(),
    deliveryChannel = 'whatsapp',
    provider = null,
    dispatchOrigin = 'cron_scan',
    dispatchReferenceKey = null,
    channelResolutionReason = null,
    businessDay = null,
    businessTimeZone = this.businessTimeZone,
    deliveryKey = null,
    force = false,
    invoiceSnapshot = null,
    ...extraFields
  }) {
    const resolvedRecipient = this.resolveRecipient(recipient);
    const finalBusinessDay = businessDay || this._getBusinessDayContext(scheduledFor).businessDayKey;
    const generatedDeliveryKey = deliveryKey || this.buildDeliveryKey({
      schoolId,
      invoiceId,
      channel: deliveryChannel,
      phone: resolvedRecipient.target_phone_normalized,
      email: resolvedRecipient.target_email_normalized,
      businessDay: finalBusinessDay,
    });

    return {
      school_id: schoolId,
      invoice_id: invoiceId,
      student_name: resolvedRecipient.student_name,
      tutor_name: resolvedRecipient.tutor_name,
      recipient_role: resolvedRecipient.recipient_role,
      recipient_student_id: resolvedRecipient.recipient_student_id,
      recipient_tutor_id: resolvedRecipient.recipient_tutor_id,
      recipient_name: resolvedRecipient.recipient_name,
      target_phone: resolvedRecipient.target_phone,
      target_phone_normalized: resolvedRecipient.target_phone_normalized,
      target_email: resolvedRecipient.target_email,
      target_email_normalized: resolvedRecipient.target_email_normalized,
      recipient_snapshot: resolvedRecipient.recipient_snapshot,
      delivery_channel: deliveryChannel,
      provider,
      channel_resolution_reason: channelResolutionReason,
      business_day: finalBusinessDay,
      business_timezone: businessTimeZone,
      delivery_key: force ? `${generatedDeliveryKey}:force:${uuidv4()}` : generatedDeliveryKey,
      dispatch_origin: force ? (dispatchOrigin || 'manual_force') : dispatchOrigin,
      dispatch_reference_key: force ? generatedDeliveryKey : dispatchReferenceKey,
      type,
      status,
      scheduled_for: scheduledFor,
      invoice_snapshot: invoiceSnapshot || null,
      ...extraFields,
    };
  }

  async createLog(input = {}) {
    const payload = this.buildCreatePayload(input);
    return this.NotificationLogModel.create(payload);
  }

  async createOutcomeLog({
    schoolId,
    invoiceId,
    recipient = {},
    type = 'manual',
    dispatchOrigin = 'manual_queue',
    deliveryChannel = 'whatsapp',
    provider = null,
    channelResolutionReason = null,
    invoiceSnapshot = null,
    outcome = {},
    referenceDate = new Date(),
  } = {}) {
    const { businessDayKey, timeZone } = this._getBusinessDayContext(referenceDate);
    const resolvedRecipient = this.resolveRecipient(recipient);
    const outcomeStatus = normalizeString(outcome?.status) || 'skipped';
    const deliveryKey = this.buildOutcomeDeliveryKey({
      schoolId,
      invoiceId,
      channel: deliveryChannel,
      phone: resolvedRecipient.target_phone_normalized,
      email: resolvedRecipient.target_email_normalized,
      businessDay: businessDayKey,
      outcomeCode: outcome?.code,
      dispatchOrigin,
    });

    return this.createLog({
      schoolId,
      invoiceId,
      recipient: resolvedRecipient,
      type,
      status: outcomeStatus,
      scheduledFor: referenceDate,
      deliveryChannel,
      provider,
      dispatchOrigin,
      channelResolutionReason,
      businessDay: businessDayKey,
      businessTimeZone: timeZone,
      deliveryKey,
      invoiceSnapshot,
      skipped_at: outcomeStatus === 'skipped' ? referenceDate : null,
      paused_at: outcomeStatus === 'paused' ? referenceDate : null,
      message_preview: outcome?.user_message || null,
      ...this.buildOutcomeMetadata(outcome),
    });
  }

  async updateLogById(logId, patch = {}, options = {}) {
    const updatePatch = { ...patch };

    if (updatePatch.recipient_snapshot || updatePatch.target_phone || updatePatch.target_email) {
      const hydrated = this.resolveRecipient(updatePatch);
      updatePatch.recipient_role = hydrated.recipient_role;
      updatePatch.recipient_student_id = hydrated.recipient_student_id;
      updatePatch.recipient_tutor_id = hydrated.recipient_tutor_id;
      updatePatch.recipient_name = hydrated.recipient_name;
      updatePatch.target_phone = hydrated.target_phone;
      updatePatch.target_phone_normalized = hydrated.target_phone_normalized;
      updatePatch.target_email = hydrated.target_email;
      updatePatch.target_email_normalized = hydrated.target_email_normalized;
      updatePatch.recipient_snapshot = hydrated.recipient_snapshot;
    }

    return this.NotificationLogModel.findByIdAndUpdate(
      logId,
      { $set: updatePatch },
      {
        new: options.new !== false,
        runValidators: true,
      }
    );
  }

  async markProcessing(logId, { processingStartedAt = new Date() } = {}) {
    return this.updateLogById(logId, {
      status: 'processing',
      processing_started_at: processingStartedAt,
    });
  }

  async markQueued(logId, {
    scheduledFor = new Date(),
    dispatchOrigin = null,
    dispatchReferenceKey = null,
  } = {}) {
    return this.updateLogById(logId, {
      status: 'queued',
      scheduled_for: scheduledFor,
      processing_started_at: null,
      sent_at: null,
      failed_at: null,
      paused_at: null,
      cancelled_at: null,
      error_message: null,
      error_code: null,
      error_http_status: null,
      error_raw: null,
      outcome_code: null,
      outcome_category: null,
      outcome_title: null,
      outcome_user_message: null,
      outcome_retryable: null,
      outcome_field: null,
      skipped_at: null,
      ...(dispatchOrigin ? { dispatch_origin: dispatchOrigin } : {}),
      ...(dispatchReferenceKey ? { dispatch_reference_key: dispatchReferenceKey } : {}),
    });
  }

  attachTransportSummary(logLike, transportLog) {
    if (!transportLog) return {};

    return {
      last_transport_log_id: transportLog._id || null,
      last_transport_status: transportLog.status || null,
      last_transport_canonical_status: transportLog.canonical_status || null,
      attempts: Number(transportLog.attempt_number || logLike?.attempts || 0),
    };
  }

  async markSent(logId, {
    sentAt = new Date(),
    transportLog = null,
    ...extraFields
  } = {}) {
    return this.updateLogById(logId, {
      status: 'sent',
      sent_at: sentAt,
      failed_at: null,
      paused_at: null,
      cancelled_at: null,
      skipped_at: null,
      error_message: null,
      error_code: null,
      error_http_status: null,
      error_raw: null,
      outcome_code: null,
      outcome_category: null,
      outcome_title: null,
      outcome_user_message: null,
      outcome_retryable: null,
      outcome_field: null,
      ...this.attachTransportSummary(extraFields, transportLog),
      ...extraFields,
    });
  }

  async markFailed(logId, {
    errorMessage = null,
    errorCode = null,
    errorHttpStatus = null,
    errorRaw = null,
    transportLog = null,
    attempts = null,
    failedAt = new Date(),
  } = {}) {
    const outcomeMetadata = errorCode
      ? this.buildOutcomeMetadata({
          code: errorCode,
        })
      : {};

    return this.updateLogById(logId, {
      status: 'failed',
      failed_at: failedAt,
      error_message: errorMessage,
      error_code: errorCode,
      error_http_status: errorHttpStatus,
      error_raw: errorRaw,
      ...outcomeMetadata,
      ...(attempts !== null ? { attempts } : {}),
      ...this.attachTransportSummary({ attempts }, transportLog),
    });
  }

  async markCancelled(logId, {
    cancelledAt = new Date(),
    cancelledByAction = null,
    cancelledReason = null,
    errorMessage = null,
    errorCode = null,
    errorHttpStatus = null,
    errorRaw = null,
    transportLog = null,
  } = {}) {
    const outcomeMetadata = errorCode
      ? this.buildOutcomeMetadata({
          code: errorCode,
        })
      : {};

    return this.updateLogById(logId, {
      status: 'cancelled',
      cancelled_at: cancelledAt,
      cancelled_by_action: cancelledByAction,
      cancelled_reason: cancelledReason,
      processing_started_at: null,
      sent_at: null,
      failed_at: null,
      paused_at: null,
      error_message: errorMessage,
      error_code: errorCode,
      error_http_status: errorHttpStatus,
      error_raw: errorRaw,
      ...outcomeMetadata,
      ...this.attachTransportSummary({}, transportLog),
    });
  }

  async markSkipped(logId, {
    skippedAt = new Date(),
    outcome = {},
    transportLog = null,
  } = {}) {
    return this.updateLogById(logId, {
      status: 'skipped',
      skipped_at: skippedAt,
      sent_at: null,
      failed_at: null,
      paused_at: null,
      processing_started_at: null,
      error_message: null,
      error_code: null,
      error_http_status: null,
      error_raw: null,
      ...this.buildOutcomeMetadata(outcome),
      ...this.attachTransportSummary({}, transportLog),
    });
  }

  async markPaused(logId, {
    pausedAt = new Date(),
    outcome = {},
    errorMessage = null,
    errorCode = null,
    errorHttpStatus = null,
    errorRaw = null,
    transportLog = null,
  } = {}) {
    const outcomePayload = errorCode
      ? { ...outcome, code: outcome?.code || errorCode }
      : outcome;

    return this.updateLogById(logId, {
      status: 'paused',
      paused_at: pausedAt,
      processing_started_at: null,
      sent_at: null,
      failed_at: null,
      cancelled_at: null,
      skipped_at: null,
      error_message: errorMessage,
      error_code: errorCode || outcomePayload?.code || null,
      error_http_status: errorHttpStatus,
      error_raw: errorRaw,
      ...this.buildOutcomeMetadata(outcomePayload),
      ...this.attachTransportSummary({}, transportLog),
    });
  }
}

const service = new NotificationLogService();

module.exports = service;
module.exports.NotificationLogService = NotificationLogService;
