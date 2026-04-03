const NotificationLog = require('../models/notification-log.model');
const NotificationTransportLog = require('../models/notification_transport_log.model');
const Invoice = require('../models/invoice.model');
const School = require('../models/school.model');
const NotificationConfig = require('../models/notification-config.model');
const WhatsappTransportLog = require('../models/whatsapp_transport_log.model');
const billingEligibilityService = require('./billingEligibility.service');
const billingMessageComposerService = require('./billingMessageComposer.service');
const notificationRecipientResolverService = require('./notificationRecipientResolver.service');
const notificationChannelSelectorService = require('./notificationChannelSelector.service');
const notificationLogService = require('./notificationLog.service');
const NotificationDispatchService = require('./notificationDispatch.service');
const WhatsappTransport = require('./transports/whatsapp.transport');
const EmailTransport = require('./transports/email.transport');
const { DEFAULT_TIME_ZONE, getBusinessDayRange, getTimeZoneParts } = require('../utils/timeContext');
const { getEmailIssueCode } = require('../utils/contact.util');
const { extractDigitableLineFromInvoice } = require('../utils/boleto.util');
const {
  buildOutcomePayload,
  getOutcomeDescriptor,
  mapLegacyReasonCode,
  mapDispatchErrorCode,
  createBatchAccumulator,
  pushBatchItem,
  buildBatchResponse,
} = require('../utils/notificationOutcome.util');

let appEmitter;
try {
  appEmitter = require('../../config/eventEmitter');
} catch (error) {
  try {
    appEmitter = require('../../loaders/eventEmitter');
  } catch {
    appEmitter = null;
  }
}

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

class NotificationService {
  constructor() {
    this.isProcessing = false;
    this.businessTimeZone = DEFAULT_TIME_ZONE;
    this.processingStaleTimeoutMinutes = Number(process.env.NOTIFICATION_PROCESSING_STALE_MINUTES || 60);
    this.delayMinMs = Number(process.env.NOTIFICATION_PROCESS_DELAY_MIN_MS || (process.env.NODE_ENV === 'test' ? 0 : 15000));
    this.delayMaxMs = Number(process.env.NOTIFICATION_PROCESS_DELAY_MAX_MS || (process.env.NODE_ENV === 'test' ? 0 : 30000));
    this.forecastCacheTtlMs = Number(process.env.NOTIFICATION_FORECAST_CACHE_TTL_MS || (process.env.NODE_ENV === 'test' ? 0 : 120000));
    this.forecastCache = new Map();

    this.dispatchService = new NotificationDispatchService();
    this.dispatchService.registerTransport('whatsapp', new WhatsappTransport());
    this.dispatchService.registerTransport('email', new EmailTransport());
  }

  _emitNotificationCreated(log) {
    if (appEmitter?.emit) appEmitter.emit('notification:created', log);
  }

  _emitNotificationUpdated(log) {
    if (appEmitter?.emit) appEmitter.emit('notification:updated', log);
  }

  _clonePlain(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  _buildForecastConfigFingerprint(config = {}) {
    const plain = config?.toObject ? config.toObject() : config;
    return JSON.stringify({
      updatedAt: plain?.updatedAt ? new Date(plain.updatedAt).toISOString() : null,
      isActive: plain?.isActive === true,
      primaryChannel: plain?.primaryChannel || null,
      allowFallback: plain?.allowFallback === true,
      fallbackChannel: plain?.fallbackChannel || null,
      windowStart: plain?.windowStart || null,
      windowEnd: plain?.windowEnd || null,
      enableNewInvoice: plain?.enableNewInvoice !== false,
      enableReminder: plain?.enableReminder !== false,
      enableDueToday: plain?.enableDueToday !== false,
      enableOverdue: plain?.enableOverdue !== false,
      channels: {
        whatsapp: {
          enabled: plain?.channels?.whatsapp?.enabled === true,
          provider: plain?.channels?.whatsapp?.provider || null,
        },
        email: {
          enabled: plain?.channels?.email?.enabled === true,
          provider: plain?.channels?.email?.provider || null,
          attachBoletoPdf: plain?.channels?.email?.attachBoletoPdf === true,
          includePaymentLink: plain?.channels?.email?.includePaymentLink !== false,
          includePixCode: plain?.channels?.email?.includePixCode !== false,
        },
      },
    });
  }

  _buildForecastCacheKey({
    schoolId,
    targetDateKey,
    configFingerprint,
    latestInvoiceUpdatedAt = null,
  }) {
    return [
      String(schoolId || '').trim(),
      String(targetDateKey || '').trim(),
      configFingerprint,
      latestInvoiceUpdatedAt ? new Date(latestInvoiceUpdatedAt).toISOString() : 'no-invoice-update',
    ].join('|');
  }

  _getCachedForecast(cacheKey) {
    if (!cacheKey || this.forecastCacheTtlMs <= 0) return null;

    const entry = this.forecastCache.get(cacheKey);
    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      this.forecastCache.delete(cacheKey);
      return null;
    }

    return this._clonePlain(entry.payload);
  }

  _setCachedForecast(cacheKey, payload) {
    if (!cacheKey || this.forecastCacheTtlMs <= 0) return payload;

    this.forecastCache.set(cacheKey, {
      payload: this._clonePlain(payload),
      expiresAt: Date.now() + this.forecastCacheTtlMs,
    });

    return payload;
  }

  invalidateForecastCache({ schoolId = null } = {}) {
    if (!schoolId) {
      this.forecastCache.clear();
      return;
    }

    const normalizedSchoolId = String(schoolId);
    [...this.forecastCache.keys()].forEach((key) => {
      if (key.startsWith(`${normalizedSchoolId}|`)) {
        this.forecastCache.delete(key);
      }
    });
  }

  _parseLocalDateInput(dateValue) {
    if (!dateValue) return null;

    if (dateValue instanceof Date) {
      const clone = new Date(dateValue);
      return Number.isNaN(clone.getTime()) ? null : clone;
    }

    const raw = String(dateValue).trim();
    if (!raw) return null;

    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const day = Number(match[3]);
      const localDate = new Date(year, month, day);
      return Number.isNaN(localDate.getTime()) ? null : localDate;
    }

    return normalizeDate(raw);
  }

  _getDayRange(dateStr) {
    const base = this._parseLocalDateInput(dateStr) || new Date();
    return getBusinessDayRange(base, this.businessTimeZone);
  }

  _getBusinessDayContext(date = new Date()) {
    return getBusinessDayRange(date, this.businessTimeZone);
  }

  _getRandomDelayMs() {
    const min = Math.max(0, Number(this.delayMinMs) || 0);
    const max = Math.max(min, Number(this.delayMaxMs) || min);
    if (max === min) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  _buildInvoiceSnapshot(invoice = {}) {
    return {
      description: invoice.description || null,
      value: typeof invoice.value === 'number' ? invoice.value : null,
      dueDate: invoice.dueDate || null,
      student: invoice.student?._id || invoice.student || null,
      tutor: invoice.tutor?._id || invoice.tutor || null,
      gateway: invoice.gateway || null,
      paymentMethod: invoice.paymentMethod || null,
      external_id: invoice.external_id ? String(invoice.external_id) : null,
      boleto_url: invoice.boleto_url || null,
      boleto_barcode: invoice.boleto_barcode || null,
      boleto_digitable_line: invoice.boleto_digitable_line || null,
      pix_code: invoice.pix_code || invoice.mp_pix_copia_e_cola || null,
    };
  }

  _mergeRecipientAndSelection(recipient = {}, selection = {}) {
    return {
      recipient_role: recipient.recipient_role,
      recipient_student_id: recipient.recipient_student_id,
      recipient_tutor_id: recipient.recipient_tutor_id,
      recipient_name: recipient.recipient_name,
      target_phone: selection.target_phone || recipient.target_phone || null,
      target_phone_normalized: selection.target_phone || recipient.target_phone_normalized || null,
      target_email: selection.target_email || recipient.target_email || null,
      target_email_normalized: selection.target_email || recipient.target_email_normalized || null,
      recipient_snapshot: recipient.recipient_snapshot,
      delivery_channel: selection.channel || null,
      provider: selection.provider || null,
      channel_resolution_reason: selection.resolution_reason || null,
    };
  }

  _normalizeDispatchError(error, channel = 'whatsapp') {
    const rawPayload = error?.response?.data || error?.transportAttempt?.raw_last_error || {
      message: error?.message || 'Erro desconhecido',
    };

    const raw = JSON.stringify(rawPayload).slice(0, 2000);
    const httpStatus = error?.response?.status || null;
    const mappedCode = mapDispatchErrorCode(error, channel);
    const descriptor = getOutcomeDescriptor(mappedCode);

    return {
      code: mappedCode,
      message: error?.message || descriptor.user_message,
      userMessage: descriptor.user_message,
      title: descriptor.title,
      category: descriptor.category,
      retryable: descriptor.retryable,
      httpStatus: httpStatus || descriptor.httpStatus || 500,
      raw,
    };
  }

  _hasPaymentArtifacts(invoice = {}) {
    return Boolean(
      normalizeString(invoice?.boleto_url) ||
      extractDigitableLineFromInvoice(invoice) ||
      normalizeString(invoice?.pix_code || invoice?.mp_pix_copia_e_cola)
    );
  }

  _buildItemContext(invoice = {}, recipient = {}, selection = {}, log = null) {
    return {
      invoice_id: invoice?._id ? String(invoice._id) : null,
      student_name:
        recipient?.student_name ||
        invoice?.student?.fullName ||
        invoice?.student_name ||
        null,
      recipient_name:
        recipient?.recipient_name ||
        recipient?.tutor_name ||
        recipient?.student_name ||
        invoice?.tutor?.fullName ||
        invoice?.student?.fullName ||
        null,
      destination_email:
        selection?.target_email ||
        recipient?.target_email ||
        null,
      destination_phone:
        selection?.target_phone ||
        recipient?.target_phone ||
        null,
      delivery_channel: selection?.channel || null,
      provider: selection?.provider || null,
      log_id: log?._id ? String(log._id) : null,
    };
  }

  _buildActionOutcome({
    invoice = {},
    recipient = {},
    selection = {},
    log = null,
    code,
    status = null,
    technicalMessage = null,
    retryable = null,
    extra = {},
  } = {}) {
    const context = this._buildItemContext(invoice, recipient, selection, log);
    const payload = buildOutcomePayload({
      code,
      status,
      technicalMessage,
      invoiceId: context.invoice_id,
      itemId: context.invoice_id,
      logId: context.log_id,
      retryable,
      extra: {
        reason_code: code,
        student_name: context.student_name,
        recipient_name: context.recipient_name,
        destination_email: context.destination_email,
        destination_phone: context.destination_phone,
        delivery_channel: context.delivery_channel,
        provider: context.provider,
        ...extra,
      },
    });

    return payload;
  }

  _isAcceptedGenericTransportStatus(status) {
    return new Set(['accepted', 'sent', 'delivered', 'read']).has(String(status || '').toLowerCase());
  }

  _isAcceptedLegacyTransportStatus(status) {
    return new Set(['accepted_by_evolution', 'server_ack', 'delivered', 'read']).has(String(status || '').toLowerCase());
  }

  async _getLatestTransportState(log = {}) {
    const genericTransport = await NotificationTransportLog.findOne({
      notification_log_id: log._id,
    }).sort({ status_rank: -1, last_event_at: -1 }).lean();

    const legacyTransport = !genericTransport
      ? await WhatsappTransportLog.findOne({
          school_id: log.school_id,
          'metadata.notification_log_id': log._id,
        }).sort({ status_rank: -1, last_event_at: -1 }).lean()
      : null;

    const hasAcceptedTransport =
      this._isAcceptedGenericTransportStatus(genericTransport?.canonical_status) ||
      this._isAcceptedLegacyTransportStatus(legacyTransport?.status);

    const acceptedAt =
      genericTransport?.accepted_at ||
      genericTransport?.sent_at ||
      genericTransport?.last_event_at ||
      legacyTransport?.accepted_at ||
      legacyTransport?.server_ack_at ||
      legacyTransport?.last_event_at ||
      null;

    return {
      genericTransport,
      legacyTransport,
      hasAcceptedTransport,
      acceptedAt,
    };
  }

  _buildQueueMaintenanceItem({
    log = {},
    code,
    status,
    userMessage = null,
    technicalMessage = null,
    retryable = false,
  } = {}) {
    const recipient = notificationLogService.resolveRecipient(log);
    return this._buildActionOutcome({
      invoice: {
        _id: log.invoice_id,
        student: { fullName: recipient.student_name || log.student_name || null },
        tutor: { fullName: recipient.recipient_name || recipient.tutor_name || log.tutor_name || null },
      },
      recipient,
      selection: {
        channel: log.delivery_channel,
        provider: log.provider,
        target_phone: recipient.target_phone,
        target_email: recipient.target_email,
      },
      log,
      code,
      status,
      technicalMessage,
      retryable,
      extra: userMessage ? { user_message: userMessage } : {},
    });
  }

  async _auditSkippedOutcome({
    invoice = null,
    recipient = {},
    selection = {},
    config = null,
    outcome = null,
    type = 'manual',
    dispatchOrigin = 'manual_queue',
    preferredChannel = null,
    referenceDate = new Date(),
  } = {}) {
    if (!invoice?._id || !invoice?.school_id || !outcome || outcome.status !== 'skipped') {
      return null;
    }

    const intendedChannel =
      selection?.channel ||
      preferredChannel ||
      config?.primaryChannel ||
      'whatsapp';

    const intendedProvider =
      selection?.provider ||
      config?.channels?.[intendedChannel]?.provider ||
      (intendedChannel === 'email' ? 'gmail' : 'evolution');

    const existingInfo = await notificationLogService.findExistingOutcomeLogForDay({
      schoolId: invoice?.school_id?._id || invoice?.school_id,
      invoiceId: invoice._id,
      channel: intendedChannel,
      outcomeCode: outcome.code,
      dispatchOrigin,
      referenceDate,
    });

    if (existingInfo.existing) {
      return existingInfo.existing;
    }

    const log = await notificationLogService.createOutcomeLog({
      schoolId: invoice?.school_id?._id || invoice?.school_id,
      invoiceId: invoice._id,
      recipient,
      type,
      dispatchOrigin,
      deliveryChannel: intendedChannel,
      provider: intendedProvider,
      channelResolutionReason: selection?.resolution_reason || selection?.reason_code || null,
      invoiceSnapshot: this._buildInvoiceSnapshot(invoice),
      outcome,
      referenceDate,
    });

    this._emitNotificationCreated(log);
    return log;
  }

  async _analyzeInvoiceForDispatch(invoiceInput, options = {}) {
    const invoice = await this._loadInvoice(invoiceInput);
    const resolvedSchoolId = invoice?.school_id?._id || invoice?.school_id || options.schoolId || null;
    const config = options.config || (resolvedSchoolId ? await this.getConfig(resolvedSchoolId) : null);

    if (!invoice) {
      return {
        ok: false,
        invoice: null,
        config,
        outcome: this._buildActionOutcome({
          code: 'INVOICE_NOT_FOUND',
          status: 'failed',
          technicalMessage: 'Invoice nao encontrada para analise.',
        }),
      };
    }

    let notificationType = options.type || 'manual';

    if (options.skipWindow !== true) {
      const evaluation = await billingEligibilityService.evaluateInvoice({
        invoice,
        config,
        referenceDate: options.referenceDate || new Date(),
        includeHold: options.includeHold !== false,
      });

      if (!evaluation.isEligible) {
        return {
          ok: false,
          invoice,
          config,
          evaluation,
          outcome: this._buildActionOutcome({
            invoice,
            code: mapLegacyReasonCode(evaluation.reason),
            status: 'skipped',
            technicalMessage: evaluation.reason,
          }),
        };
      }

      notificationType = evaluation.type || notificationType;
    } else {
      if (invoice.status === 'paid') {
        return {
          ok: false,
          invoice,
          config,
          outcome: this._buildActionOutcome({
            invoice,
            code: 'INVOICE_ALREADY_PAID',
            status: 'skipped',
            technicalMessage: 'Invoice paga na analise manual.',
          }),
        };
      }

      if (invoice.status === 'canceled') {
        return {
          ok: false,
          invoice,
          config,
          outcome: this._buildActionOutcome({
            invoice,
            code: 'INVOICE_CANCELLED',
            status: 'skipped',
            technicalMessage: 'Invoice cancelada na analise manual.',
          }),
        };
      }

      if (options.includeHold !== false) {
        const holdState = await billingEligibilityService.isInvoiceOnHold(invoice);
        if (holdState.onHold) {
          return {
            ok: false,
            invoice,
            config,
            evaluation: {
              isEligible: false,
              type: notificationType,
              reason: 'HOLD_ACTIVE',
              onHold: true,
              compensation: holdState.compensation || null,
            },
            outcome: this._buildActionOutcome({
              invoice,
              code: 'HOLD_ACTIVE',
              status: 'skipped',
              technicalMessage: 'Invoice em HOLD/compensacao.',
            }),
          };
        }
      }
    }

    const recipient = await notificationRecipientResolverService.resolveByInvoice(invoice);
    const selection = notificationChannelSelectorService.selectChannel({
      config,
      recipient,
      preferredChannel: options.preferredChannel || null,
    });

    if (!selection.channel) {
      return {
        ok: false,
        invoice,
        config,
        recipient,
        selection,
        outcome: this._buildActionOutcome({
          invoice,
          recipient,
          selection,
          code: selection.reason_code || 'NO_CHANNEL_AVAILABLE',
          status: 'skipped',
          technicalMessage: selection.resolution_reason || 'No channel selected.',
        }),
      };
    }

    if (selection.channel === 'email') {
      const emailIssueCode = normalizeString(recipient?.email_issue_code) || getEmailIssueCode(recipient?.target_email);
      if (emailIssueCode) {
        return {
          ok: false,
          invoice,
          config,
          recipient,
          selection,
          outcome: this._buildActionOutcome({
            invoice,
            recipient,
            selection,
            code: emailIssueCode,
            status: 'skipped',
            technicalMessage: emailIssueCode,
          }),
        };
      }
    }

    if (options.requirePaymentData !== false && !this._hasPaymentArtifacts(invoice)) {
      return {
        ok: false,
        invoice,
        config,
        recipient,
        selection,
        outcome: this._buildActionOutcome({
          invoice,
          recipient,
          selection,
          code: 'BOLETO_UNAVAILABLE',
          status: 'skipped',
          technicalMessage: 'Invoice sem boleto, link ou PIX disponivel.',
        }),
      };
    }

    let existingInfo = null;
    if (options.checkDuplicates === true && options.force !== true) {
      existingInfo = await notificationLogService.findExistingLogForDay({
        schoolId: invoice?.school_id?._id || invoice?.school_id,
        invoiceId: invoice._id,
        channel: selection.channel,
        phone: selection.target_phone || recipient.target_phone,
        email: selection.target_email || recipient.target_email,
        referenceDate: options.referenceDate || new Date(),
      });

      if (existingInfo.existing) {
        return {
          ok: false,
          invoice,
          config,
          recipient,
          selection,
          existingInfo,
          outcome: this._buildActionOutcome({
            invoice,
            recipient,
            selection,
            log: existingInfo.existing,
            code: 'ALREADY_QUEUED_OR_SENT_TODAY',
            status: 'skipped',
            technicalMessage: 'Ja existe log para o dia/canal/destino.',
          }),
        };
      }
    }

    if (options.validateTransportReady === true) {
      try {
        await this.dispatchService.assertReady(selection.channel, {
          config,
          invoice,
          recipient,
          selection,
        });
      } catch (error) {
        const mappedCode = mapDispatchErrorCode(error, selection.channel);
        const descriptor = getOutcomeDescriptor(mappedCode);

        return {
          ok: false,
          invoice,
          config,
          recipient,
          selection,
          outcome: this._buildActionOutcome({
            invoice,
            recipient,
            selection,
            code: mappedCode,
            status: 'failed',
            technicalMessage: error.message || descriptor.user_message,
            retryable: descriptor.retryable,
          }),
        };
      }
    }

    return {
      ok: true,
      invoice,
      config,
      recipient,
      selection,
      type: notificationType,
      existingInfo,
    };
  }

  async _loadInvoice(invoiceOrId) {
    const invoiceId = invoiceOrId?._id || invoiceOrId;
    if (!invoiceId) return null;

    if (invoiceOrId?.student?.fullName || invoiceOrId?.tutor?.fullName) {
      return invoiceOrId;
    }

    return Invoice.findById(invoiceId).populate('student').populate('tutor');
  }

  async _getSchoolConfigMap(filter = {}) {
    const configs = await NotificationConfig.find(filter).lean();
    return new Map(configs.map((config) => [String(config.school_id), config]));
  }

  isEligibleForSending(dueDate, referenceDate = new Date()) {
    return billingEligibilityService.isEligibleForSending(dueDate, referenceDate);
  }

  async queueNotification({
    schoolId,
    invoiceId,
    studentName,
    tutorName,
    phone = null,
    targetEmail = null,
    type = 'new_invoice',
    force = false,
    dispatchOrigin = 'cron_scan',
    deliveryChannel = 'whatsapp',
    provider = null,
    recipientSnapshot = null,
    recipientRole = null,
    recipientStudentId = null,
    recipientTutorId = null,
    recipientName = null,
    channelResolutionReason = null,
    invoiceSnapshot = null,
  }) {
    try {
      const now = new Date();
      const existingInfo = await notificationLogService.findExistingLogForDay({
        schoolId,
        invoiceId,
        channel: deliveryChannel,
        phone,
        email: targetEmail,
        referenceDate: now,
      });

      if (!force && existingInfo.existing) {
        return {
          ok: false,
          skipped: true,
          reason: 'ALREADY_QUEUED_OR_SENT_TODAY',
          log: existingInfo.existing,
        };
      }

      const log = await notificationLogService.createLog({
        schoolId,
        invoiceId,
        recipient: {
          student_name: studentName,
          tutor_name: tutorName,
          recipient_role: recipientRole,
          recipient_student_id: recipientStudentId,
          recipient_tutor_id: recipientTutorId,
          recipient_name: recipientName || tutorName || studentName,
          target_phone: phone,
          target_email: targetEmail,
          recipient_snapshot: recipientSnapshot,
        },
        type,
        status: 'queued',
        scheduledFor: now,
        deliveryChannel,
        provider,
        dispatchOrigin,
        channelResolutionReason,
        businessDay: existingInfo.businessDay,
        businessTimeZone: existingInfo.businessTimeZone,
        deliveryKey: existingInfo.deliveryKey,
        force,
        invoiceSnapshot,
      });

      this._emitNotificationCreated(log);
      return { ok: true, log };
    } catch (error) {
      if (error?.code === 11000) {
        const duplicate = await NotificationLog.findOne({
          school_id: schoolId,
          invoice_id: invoiceId,
        }).sort({ createdAt: -1 }).lean();

        return {
          ok: false,
          skipped: true,
          reason: 'ALREADY_QUEUED_OR_SENT_TODAY',
          log: duplicate || null,
        };
      }

      return {
        ok: false,
        skipped: false,
        error,
      };
    }
  }

  async _prepareAndQueue(invoice, type, options = {}) {
    const analysis = await this._analyzeInvoiceForDispatch(invoice, {
      config: options.config,
      type,
      preferredChannel: options.preferredChannel || null,
      force: options.force === true,
      dispatchOrigin: options.dispatchOrigin || 'cron_scan',
      skipWindow: options.skipWindow === true,
      referenceDate: options.referenceDate || new Date(),
      includeHold: options.includeHold !== false,
      requirePaymentData: options.requirePaymentData !== false,
      checkDuplicates: options.checkDuplicates === true,
      validateTransportReady: options.validateTransportReady === true,
    });

    if (!analysis.ok) {
      let auditLog = null;
      if (analysis.outcome?.status === 'skipped') {
        auditLog = await this._auditSkippedOutcome({
          invoice: analysis.invoice,
          recipient: analysis.recipient || {},
          selection: analysis.selection || {},
          config: analysis.config || options.config || null,
          outcome: analysis.outcome,
          type: analysis.type || type,
          dispatchOrigin: options.dispatchOrigin || 'cron_scan',
          preferredChannel: options.preferredChannel || null,
          referenceDate: options.referenceDate || new Date(),
        });

        if (auditLog?._id) {
          analysis.outcome.log_id = String(auditLog._id);
        }
      }

      return {
        ok: false,
        skipped: analysis.outcome?.status === 'skipped',
        failed: analysis.outcome?.status === 'failed',
        reason: analysis.outcome?.code || 'QUEUE_FAILED',
        outcome: analysis.outcome,
        log: auditLog,
        invoice: analysis.invoice,
        recipient: analysis.recipient,
        selection: analysis.selection,
        existingInfo: analysis.existingInfo || null,
      };
    }

    const { invoice: preparedInvoice, recipient, selection } = analysis;
    const schoolId = preparedInvoice?.school_id?._id || preparedInvoice?.school_id;

    const result = await this.queueNotification({
      schoolId,
      invoiceId: preparedInvoice._id,
      studentName: recipient.student_name || preparedInvoice?.student?.fullName || 'Aluno',
      tutorName: recipient.tutor_name || recipient.recipient_name || null,
      phone: selection.target_phone || recipient.target_phone,
      targetEmail: selection.target_email || recipient.target_email,
      type: analysis.type || type,
      force: options.force === true,
      dispatchOrigin: options.dispatchOrigin || 'cron_scan',
      deliveryChannel: selection.channel,
      provider: selection.provider,
      recipientSnapshot: recipient.recipient_snapshot,
      recipientRole: recipient.recipient_role,
      recipientStudentId: recipient.recipient_student_id,
      recipientTutorId: recipient.recipient_tutor_id,
      recipientName: recipient.recipient_name,
      channelResolutionReason: selection.resolution_reason,
      invoiceSnapshot: this._buildInvoiceSnapshot(preparedInvoice),
    });

    if (!result.ok) {
      return {
        ...result,
        outcome: this._buildActionOutcome({
          invoice: preparedInvoice,
          recipient,
          selection,
          log: result.log,
          code: result.reason || 'INTERNAL_ERROR',
          status: result.skipped ? 'skipped' : 'failed',
          technicalMessage: result.error?.message || result.reason || 'Falha ao criar NotificationLog.',
        }),
        recipient,
        selection,
      };
    }

    return {
      ...result,
      invoice: preparedInvoice,
      recipient,
      selection,
      outcome: this._buildActionOutcome({
        invoice: preparedInvoice,
        recipient,
        selection,
        log: result.log,
        code: 'NOTIFICATION_QUEUED',
        status: 'queued',
      }),
    };
  }

  async enqueueInvoiceManually({
    schoolId,
    invoice,
    type = 'manual',
    force = false,
    dispatchOrigin = 'manual_queue',
    processNow = false,
  }) {
    const result = await this._prepareAndQueue(invoice, type, {
      force,
      dispatchOrigin: force ? 'manual_force' : dispatchOrigin,
      config: await this.getConfig(schoolId),
      skipWindow: true,
      checkDuplicates: true,
      validateTransportReady: true,
    });

    if (!result.ok) {
      return result.outcome;
    }

    if (processNow) {
      const processedLog = await this.processNotificationLogNow(result.log._id);

      if (processedLog?.status === 'failed') {
        return this._buildActionOutcome({
          invoice: result.invoice,
          recipient: result.recipient,
          selection: result.selection,
          log: processedLog,
          code: processedLog.error_code || 'INTERNAL_ERROR',
          status: 'failed',
          technicalMessage: processedLog.error_message || 'Falha ao enviar cobranca.',
          retryable: getOutcomeDescriptor(processedLog.error_code || 'INTERNAL_ERROR').retryable,
        });
      }

      if (processedLog?.status === 'cancelled') {
        return this._buildActionOutcome({
          invoice: result.invoice,
          recipient: result.recipient,
          selection: result.selection,
          log: processedLog,
          code: processedLog.error_code || 'NO_CHANNEL_AVAILABLE',
          status: 'skipped',
          technicalMessage: processedLog.error_message || 'Cobranca cancelada antes do envio.',
        });
      }

      if (processedLog?.status === 'sent') {
        return this._buildActionOutcome({
          invoice: result.invoice,
          recipient: result.recipient,
          selection: result.selection,
          log: processedLog,
          code: 'NOTIFICATION_SENT',
          status: 'sent',
          extra: {
            sent_at: processedLog.sent_at || null,
          },
        });
      }
    }

    return result.outcome;
  }

  async scanAndQueueInvoices(options = {}) {
    const configFilter = { isActive: true };
    if (options.schoolId) configFilter.school_id = options.schoolId;

    const activeConfigs = await NotificationConfig.find(configFilter).lean();
    if (!activeConfigs.length) {
      return options.collectResults ? buildBatchResponse(createBatchAccumulator()) : undefined;
    }

    const now = new Date();
    const currentTimeParts = getTimeZoneParts(now, this.businessTimeZone);
    const currentMinutes = currentTimeParts.hour * 60 + currentTimeParts.minute;
    const batch = options.collectResults ? createBatchAccumulator() : null;

    for (const config of activeConfigs) {
      const [startH, startM] = String(config.windowStart || '08:00').split(':').map(Number);
      const [endH, endM] = String(config.windowEnd || '18:00').split(':').map(Number);

      if (currentMinutes < (startH * 60 + startM) || currentMinutes >= (endH * 60 + endM)) {
        continue;
      }

      const hojeStart = new Date(now); hojeStart.setHours(0, 0, 0, 0);
      const hojeEnd = new Date(now); hojeEnd.setHours(23, 59, 59, 999);
      const limitPassado = new Date(now); limitPassado.setDate(limitPassado.getDate() - 60); limitPassado.setHours(0, 0, 0, 0);
      const futuroStart = new Date(now); futuroStart.setDate(futuroStart.getDate() + 3); futuroStart.setHours(0, 0, 0, 0);
      const futuroEnd = new Date(now); futuroEnd.setDate(futuroEnd.getDate() + 3); futuroEnd.setHours(23, 59, 59, 999);

      const orConditions = [
        { dueDate: { $gte: limitPassado, $lte: hojeEnd } },
        { dueDate: { $gte: futuroStart, $lte: futuroEnd } },
      ];

      if (now.getDate() === 1) {
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        orConditions.push({ dueDate: { $gte: hojeStart, $lte: monthEnd } });
      }

      const invoices = await Invoice.find({
        school_id: config.school_id,
        status: 'pending',
        $or: orConditions,
      }).populate('student').populate('tutor');

      for (const invoice of invoices) {
        const prepared = await this._prepareAndQueue(invoice, null, {
          config,
          dispatchOrigin: options.dispatchOrigin || 'cron_scan',
          referenceDate: now,
          checkDuplicates: true,
        });

        if (!batch) continue;

        const outcome = prepared.outcome || this._buildActionOutcome({
          invoice,
          recipient: prepared.recipient,
          selection: prepared.selection,
          log: prepared.log,
          code: prepared.ok ? 'NOTIFICATION_QUEUED' : (prepared.reason || 'INTERNAL_ERROR'),
          status: prepared.ok ? 'queued' : (prepared.skipped ? 'skipped' : 'failed'),
        });

        pushBatchItem(batch, {
          invoice_id: outcome.invoice_id,
          student_name: outcome.student_name,
          recipient_name: outcome.recipient_name,
          destination_email: outcome.destination_email,
          destination_phone: outcome.destination_phone,
          status: outcome.status,
          reason_code: outcome.code,
          user_message: outcome.user_message,
          retryable: outcome.retryable,
          is_eligible: prepared.ok,
        });
      }
    }

    if (options.schoolId) {
      this.invalidateForecastCache({ schoolId: options.schoolId });
    } else if (activeConfigs.length > 0) {
      this.invalidateForecastCache();
    }

    return batch ? buildBatchResponse(batch) : undefined;
  }

  async queueMonthInvoicesManually(schoolId) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    const config = await this.getConfig(schoolId);

    const invoices = await Invoice.find({
      school_id: schoolId,
      status: { $in: ['pending', 'overdue', 'paid', 'canceled'] },
      dueDate: { $gte: start, $lte: monthEnd },
    }).populate('student').populate('tutor');

    const batch = createBatchAccumulator();
    for (const invoice of invoices) {
      const result = await this._prepareAndQueue(invoice, 'new_invoice', {
        config,
        dispatchOrigin: 'manual_month',
        skipWindow: true,
        checkDuplicates: true,
        validateTransportReady: true,
      });

      const outcome = result.outcome || this._buildActionOutcome({
        invoice,
        recipient: result.recipient,
        selection: result.selection,
        log: result.log,
        code: result.ok ? 'NOTIFICATION_QUEUED' : (result.reason || 'INTERNAL_ERROR'),
        status: result.ok ? 'queued' : (result.skipped ? 'skipped' : 'failed'),
      });

      pushBatchItem(batch, {
        invoice_id: outcome.invoice_id,
        student_name: outcome.student_name,
        recipient_name: outcome.recipient_name,
        destination_email: outcome.destination_email,
        destination_phone: outcome.destination_phone,
        status: outcome.status,
        reason_code: outcome.code,
        user_message: outcome.user_message,
        retryable: outcome.retryable,
        is_eligible: result.ok,
      });
    }

    this.invalidateForecastCache({ schoolId });
    return buildBatchResponse(batch);
  }

  async clearPendingQueue(schoolId, options = {}) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - (this.processingStaleTimeoutMinutes * 60 * 1000));
    const cancellationAction = normalizeString(options.cancelledByAction) || 'queue_clear';
    const cancellationReason =
      normalizeString(options.cancelledReason) || 'manual_queue_reset_before_email_rollout';

    const pendingLogs = await NotificationLog.find({
      school_id: schoolId,
      status: { $in: ['queued', 'processing'] },
    }).sort({ createdAt: 1 });

    const response = {
      success: true,
      has_failures: false,
      total_analisado: pendingLogs.length,
      total_elegivel: 0,
      total_queued: 0,
      total_skipped: 0,
      total_failed: 0,
      total_cancelled: 0,
      total_already_processed: 0,
      total_untouched: 0,
      breakdown: {},
      items: [],
    };

    for (const logDoc of pendingLogs) {
      const log = logDoc?.toObject ? logDoc.toObject() : logDoc;

      if (log.status === 'queued') {
        const cancelledLog = await notificationLogService.markCancelled(log._id, {
          cancelledAt: now,
          cancelledByAction: cancellationAction,
          cancelledReason: cancellationReason,
          errorMessage: 'Item removido manualmente da fila antes da virada operacional para e-mail.',
          errorCode: 'QUEUE_CLEAR_CANCELLED',
          errorHttpStatus: 200,
        });

        response.total_cancelled += 1;
        response.breakdown.QUEUE_CLEAR_CANCELLED = (response.breakdown.QUEUE_CLEAR_CANCELLED || 0) + 1;
        response.items.push(this._buildQueueMaintenanceItem({
          log: cancelledLog,
          code: 'QUEUE_CLEAR_CANCELLED',
          status: 'cancelled',
        }));
        this._emitNotificationUpdated(cancelledLog);
        continue;
      }

      const transportState = await this._getLatestTransportState(log);

      if (transportState.hasAcceptedTransport) {
        const sentLog = await notificationLogService.markSent(log._id, {
          sentAt: transportState.acceptedAt || now,
          transportLog: transportState.genericTransport || transportState.legacyTransport || null,
        });

        response.total_already_processed += 1;
        response.breakdown.QUEUE_CLEAR_ALREADY_PROCESSED =
          (response.breakdown.QUEUE_CLEAR_ALREADY_PROCESSED || 0) + 1;
        response.items.push(this._buildQueueMaintenanceItem({
          log: sentLog,
          code: 'QUEUE_CLEAR_ALREADY_PROCESSED',
          status: 'sent',
        }));
        this._emitNotificationUpdated(sentLog);
        continue;
      }

      const referenceTimestamp =
        normalizeDate(log.processing_started_at) ||
        normalizeDate(log.updatedAt) ||
        normalizeDate(log.createdAt) ||
        now;

      const isStale = referenceTimestamp <= cutoff;

      if (isStale) {
        const cancelledLog = await notificationLogService.markCancelled(log._id, {
          cancelledAt: now,
          cancelledByAction: cancellationAction,
          cancelledReason: cancellationReason,
          errorMessage: 'Processamento preso removido manualmente da fila antes da virada operacional para e-mail.',
          errorCode: 'QUEUE_CLEAR_CANCELLED',
          errorHttpStatus: 200,
          transportLog: transportState.genericTransport || null,
        });

        response.total_cancelled += 1;
        response.breakdown.QUEUE_CLEAR_CANCELLED = (response.breakdown.QUEUE_CLEAR_CANCELLED || 0) + 1;
        response.items.push(this._buildQueueMaintenanceItem({
          log: cancelledLog,
          code: 'QUEUE_CLEAR_CANCELLED',
          status: 'cancelled',
        }));
        this._emitNotificationUpdated(cancelledLog);
        continue;
      }

      response.total_untouched += 1;
      response.breakdown.QUEUE_CLEAR_ACTIVE_PROCESSING_UNTOUCHED =
        (response.breakdown.QUEUE_CLEAR_ACTIVE_PROCESSING_UNTOUCHED || 0) + 1;
      response.items.push(this._buildQueueMaintenanceItem({
        log,
        code: 'QUEUE_CLEAR_ACTIVE_PROCESSING_UNTOUCHED',
        status: 'processing',
      }));
    }

    if (response.total_cancelled > 0 && response.total_untouched > 0) {
      response.user_message =
        `${response.total_cancelled} itens pendentes foram removidos da fila. ` +
        `${response.total_untouched} itens em processamento ativo foram preservados por segurança. ` +
        'O histórico de envios foi preservado.';
    } else if (response.total_cancelled > 0) {
      response.user_message = `${response.total_cancelled} itens pendentes foram removidos da fila. O histórico de envios foi preservado.`;
    } else if (response.total_untouched > 0) {
      response.user_message =
        'Nenhum item pendente foi cancelado automaticamente porque ainda existem registros em processamento ativo.';
    } else {
      response.user_message = 'Não há itens pendentes na fila para limpar.';
    }

    response.message = response.user_message;
    this.invalidateForecastCache({ schoolId });
    return response;
  }

  async _recoverStaleProcessingLogs(options = {}) {
    const cutoff = new Date(Date.now() - (this.processingStaleTimeoutMinutes * 60 * 1000));
    const filter = {
      status: 'processing',
      updatedAt: { $lte: cutoff },
    };
    if (options.schoolId) filter.school_id = options.schoolId;

    const stuckLogs = await NotificationLog.find(filter).lean();
    let recovered = 0;

    for (const log of stuckLogs) {
      const genericTransport = await NotificationTransportLog.findOne({
        notification_log_id: log._id,
      }).sort({ status_rank: -1, last_event_at: -1 }).lean();

      const legacyTransport = !genericTransport
        ? await WhatsappTransportLog.findOne({
            school_id: log.school_id,
            'metadata.notification_log_id': log._id,
          }).sort({ status_rank: -1, last_event_at: -1 }).lean()
        : null;

      const genericAccepted = new Set(['accepted', 'sent', 'delivered', 'read']);
      const legacyAccepted = new Set(['accepted_by_evolution', 'server_ack', 'delivered', 'read']);

      if (log.sent_at || genericAccepted.has(genericTransport?.canonical_status) || legacyAccepted.has(legacyTransport?.status)) {
        const sentAt =
          genericTransport?.accepted_at ||
          genericTransport?.sent_at ||
          genericTransport?.last_event_at ||
          legacyTransport?.accepted_at ||
          legacyTransport?.server_ack_at ||
          legacyTransport?.last_event_at ||
          new Date();

        await notificationLogService.markSent(log._id, {
          sentAt,
          transportLog: genericTransport,
        });
        recovered += 1;
        continue;
      }

      await notificationLogService.updateLogById(log._id, {
        status: 'queued',
        scheduled_for: new Date(),
        processing_started_at: null,
        error_message: 'Recuperado de processing preso.',
        error_code: 'PROCESSING_TIMEOUT_RECOVERED',
        error_http_status: null,
        error_raw: JSON.stringify({
          cutoff: cutoff.toISOString(),
          recovered_at: new Date().toISOString(),
        }).slice(0, 2000),
      });
      recovered += 1;
    }

    return { recovered };
  }

  async _executeNotificationLog(log) {
    const invoice = await this._loadInvoice(log.invoice_id);
    if (!invoice) {
      await notificationLogService.markCancelled(log._id, {
        errorMessage: 'Fatura nao encontrada.',
        errorCode: 'INVOICE_NOT_FOUND',
        errorHttpStatus: 404,
      });
      return NotificationLog.findById(log._id);
    }

    if (invoice.status === 'paid' || invoice.status === 'canceled') {
      const errorCode = invoice.status === 'paid' ? 'INVOICE_ALREADY_PAID' : 'INVOICE_CANCELLED';
      await notificationLogService.markCancelled(log._id, {
        errorMessage: 'Fatura ja paga/cancelada.',
        errorCode,
        errorHttpStatus: 200,
      });
      return NotificationLog.findById(log._id);
    }

    const holdState = await billingEligibilityService.isInvoiceOnHold(invoice);
    if (holdState.onHold) {
      await notificationLogService.markCancelled(log._id, {
        errorMessage: 'Invoice esta com compensacao/HOLD ativo.',
        errorCode: 'HOLD_ACTIVE',
        errorHttpStatus: 200,
      });
      return NotificationLog.findById(log._id);
    }

    if (!this._hasPaymentArtifacts(invoice)) {
      await notificationLogService.markCancelled(log._id, {
        errorMessage: 'Invoice sem boleto, link ou PIX disponivel.',
        errorCode: 'BOLETO_UNAVAILABLE',
        errorHttpStatus: 200,
      });
      return NotificationLog.findById(log._id);
    }

    const school = await School.findById(log.school_id).select('name whatsapp').lean();
    const config = await this.getConfig(log.school_id);
    const recipient = notificationLogService.resolveRecipient(log);
    const selection = notificationChannelSelectorService.selectChannel({
      config,
      recipient,
      preferredChannel: log.delivery_channel,
    });

    if (!selection.channel) {
      const noChannelError = new Error('Nao ha canal disponivel para este destinatario.');
      noChannelError.code = selection.reason_code || 'NO_CHANNEL_AVAILABLE';
      throw noChannelError;
    }

    const message = billingMessageComposerService.compose({
      notificationLog: log,
      invoice,
      school,
      config,
      referenceDate: new Date(),
    });

    const updatedLog = await notificationLogService.updateLogById(log._id, {
      ...this._mergeRecipientAndSelection(recipient, selection),
      template_group: message.template_group,
      template_index: message.template_index,
      message_subject: message.subject || null,
      message_text: message.text || null,
      message_html_preview: (message.html || '').slice(0, 4000) || null,
      message_preview: message.message_preview || null,
      sent_gateway: invoice.gateway || null,
      sent_gateway_charge_id: invoice.external_id ? String(invoice.external_id) : null,
      sent_boleto_url: message.payment_link || invoice.boleto_url || null,
      sent_barcode: message.barcode || invoice.boleto_barcode || null,
      sent_digitable_line: message.digitable_line || invoice.boleto_digitable_line || null,
      invoice_snapshot: this._buildInvoiceSnapshot(invoice),
    });

    const dispatchResult = await this.dispatchService.dispatch({
      notificationLog: updatedLog,
      invoice,
      school,
      config,
      message,
    });

    return notificationLogService.markSent(updatedLog._id, {
      sentAt:
        dispatchResult?.attempt?.sent_at ||
        dispatchResult?.attempt?.accepted_at ||
        new Date(),
      transportLog: dispatchResult?.attempt || null,
    });
  }

  async processNotificationLogNow(logId) {
    const queuedLog = await NotificationLog.findOneAndUpdate(
      { _id: logId, status: 'queued' },
      { $set: { status: 'processing', processing_started_at: new Date() } },
      { new: true }
    );

    const currentLog = queuedLog || await NotificationLog.findById(logId);
    if (!currentLog) return null;
    if (currentLog.status !== 'processing') return currentLog;
    this._emitNotificationUpdated(currentLog);

    try {
      const finalLog = await this._executeNotificationLog(currentLog);
      this._emitNotificationUpdated(finalLog);
      return finalLog;
    } catch (error) {
      const normalized = this._normalizeDispatchError(error, currentLog.delivery_channel);
      const failedLog = await notificationLogService.markFailed(currentLog._id, {
        errorMessage: normalized.message,
        errorCode: normalized.code,
        errorHttpStatus: normalized.httpStatus,
        errorRaw: normalized.raw,
        transportLog: error.transportAttempt || null,
      });
      this._emitNotificationUpdated(failedLog);
      return failedLog;
    }
  }

  async processQueue(options = {}) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await this._recoverStaleProcessingLogs(options);

      const queuedFilter = {
        status: 'queued',
        scheduled_for: { $lte: new Date() },
      };
      if (options.schoolId) queuedFilter.school_id = options.schoolId;

      const queuedCandidates = await NotificationLog.find(queuedFilter)
        .sort({ createdAt: 1 })
        .select('_id school_id scheduled_for')
        .lean();

      if (!queuedCandidates.length) return;

      const schoolIds = [...new Set(queuedCandidates.map((item) => String(item.school_id)))];
      const configMap = await this._getSchoolConfigMap({
        school_id: { $in: schoolIds },
        isActive: true,
      });

      const nextCandidate = queuedCandidates.find((item) => configMap.has(String(item.school_id)));
      if (!nextCandidate) return;

      const processingLog = await NotificationLog.findOneAndUpdate(
        { _id: nextCandidate._id, status: 'queued' },
        { $set: { status: 'processing', processing_started_at: new Date() } },
        { new: true }
      );

      if (!processingLog) return;
      this._emitNotificationUpdated(processingLog);

      const delay = this._getRandomDelayMs();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

      const schoolStillActive = await NotificationConfig.findOne({
        school_id: processingLog.school_id,
        isActive: true,
      }).select('_id').lean();

      if (!schoolStillActive) {
        const pausedLog = await notificationLogService.markQueued(processingLog._id, {
          scheduledFor: new Date(),
        });
        this._emitNotificationUpdated(pausedLog);
        return;
      }

      try {
        const finalLog = await this._executeNotificationLog(processingLog);
        this._emitNotificationUpdated(finalLog);
      } catch (error) {
        const normalized = this._normalizeDispatchError(error, processingLog.delivery_channel);
        const failedLog = await notificationLogService.markFailed(processingLog._id, {
          errorMessage: normalized.message,
          errorCode: normalized.code,
          errorHttpStatus: normalized.httpStatus,
          errorRaw: normalized.raw,
          transportLog: error.transportAttempt || null,
        });
        this._emitNotificationUpdated(failedLog);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async getLogs(schoolId, status, page = 1, limit = 20, dateStr, options = {}) {
    const normalizedStatus = normalizeString(status);
    const normalizedScope = normalizeString(options.scope) ||
      ((normalizedStatus === 'queued' || normalizedStatus === 'processing') ? 'operational' : 'selected_day');
    const isOperationalScope =
      normalizedScope === 'operational' &&
      (normalizedStatus === 'queued' || normalizedStatus === 'processing');
    const { startOfDay, endOfDay } = this._getDayRange(dateStr);
    const query = { school_id: schoolId };

    if (!isOperationalScope) {
      query.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }

    if (normalizedStatus && normalizedStatus !== 'Todos') query.status = normalizedStatus;

    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const shouldPaginate = limit && limit !== 'all' && Number(limit) > 0;
    const safeLimit = shouldPaginate ? Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100) : null;

    const sort = isOperationalScope
      ? (normalizedStatus === 'processing'
          ? { processing_started_at: 1, createdAt: 1 }
          : { scheduled_for: 1, createdAt: 1 })
      : { createdAt: -1 };

    let dbQuery = NotificationLog.find(query).sort(sort);
    if (shouldPaginate) dbQuery = dbQuery.skip((safePage - 1) * safeLimit).limit(safeLimit);

    const [logs, total] = await Promise.all([
      dbQuery.lean(),
      NotificationLog.countDocuments(query),
    ]);

    return {
      logs: logs.map((log) => {
        const recipient = notificationLogService.resolveRecipient(log);
        const errorDescriptor = log.error_code ? getOutcomeDescriptor(log.error_code) : null;
        return {
          ...log,
          ...recipient,
          delivery_channel: log.delivery_channel || 'whatsapp',
          provider: log.provider || (log.delivery_channel === 'email' ? 'gmail' : 'evolution'),
          reason_code: log.outcome_code || log.error_code || null,
          reason_category: log.outcome_category || errorDescriptor?.category || null,
          reason_title: log.outcome_title || errorDescriptor?.title || null,
          user_message: log.outcome_user_message || errorDescriptor?.user_message || null,
          error_title: errorDescriptor?.title || null,
          error_user_message: errorDescriptor?.user_message || null,
          retryable: log.outcome_retryable ?? errorDescriptor?.retryable ?? null,
          scope: isOperationalScope ? 'operational' : 'selected_day',
        };
      }),
      total,
      pages: shouldPaginate ? Math.max(Math.ceil(total / safeLimit), 1) : 1,
      scope: isOperationalScope ? 'operational' : 'selected_day',
    };
  }

  async getDailyStats(schoolId, dateStr) {
    const { startOfDay, endOfDay } = this._getDayRange(dateStr);
    const [logs, operationalLogs] = await Promise.all([
      NotificationLog.find({
        school_id: schoolId,
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      }).select('status delivery_channel provider').lean(),
      NotificationLog.find({
        school_id: schoolId,
        status: { $in: ['queued', 'processing'] },
      }).select('status delivery_channel provider').lean(),
    ]);

    const result = {
      queued: 0,
      processing: 0,
      queued_today: 0,
      processing_today: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
      total_today: 0,
      queue_scope: 'current',
      history_scope: 'selected_day',
      by_channel: {},
      by_provider: {},
      by_channel_status: {},
      operational_by_channel_status: {},
    };

    logs.forEach((log) => {
      if (log.status === 'queued') result.queued_today += 1;
      if (log.status === 'processing') result.processing_today += 1;
      if (['sent', 'failed', 'cancelled', 'skipped'].includes(log.status)) {
        result[log.status] += 1;
      }
      result.total_today += 1;

      const channel = log.delivery_channel || 'whatsapp';
      const provider = log.provider || (channel === 'email' ? 'gmail' : 'evolution');
      result.by_channel[channel] = (result.by_channel[channel] || 0) + 1;
      result.by_provider[provider] = (result.by_provider[provider] || 0) + 1;
      if (!result.by_channel_status[channel]) {
        result.by_channel_status[channel] = {
          queued: 0,
          processing: 0,
          sent: 0,
          failed: 0,
          cancelled: 0,
          skipped: 0,
          total: 0,
        };
      }
      if (result.by_channel_status[channel][log.status] !== undefined) {
        result.by_channel_status[channel][log.status] += 1;
      }
      result.by_channel_status[channel].total += 1;
    });

    operationalLogs.forEach((log) => {
      if (log.status === 'queued') result.queued += 1;
      if (log.status === 'processing') result.processing += 1;

      const channel = log.delivery_channel || 'whatsapp';
      if (!result.operational_by_channel_status[channel]) {
        result.operational_by_channel_status[channel] = {
          queued: 0,
          processing: 0,
          total: 0,
        };
      }

      if (log.status === 'queued' || log.status === 'processing') {
        result.operational_by_channel_status[channel][log.status] += 1;
        result.operational_by_channel_status[channel].total += 1;
      }
    });

    return result;
  }

  async getForecast(schoolId, targetDate) {
    const simData = this._parseLocalDateInput(targetDate) || new Date();
    if (!targetDate) simData.setDate(simData.getDate() + 1);
    simData.setHours(12, 0, 0, 0);

    const limitPassado = new Date(simData); limitPassado.setDate(limitPassado.getDate() - 60); limitPassado.setHours(0, 0, 0, 0);
    const futuroLimit = new Date(simData); futuroLimit.setDate(futuroLimit.getDate() + 5); futuroLimit.setHours(23, 59, 59, 999);
    const config = await this.getConfig(schoolId);
    const latestInvoice = await Invoice.findOne({ school_id: schoolId })
      .sort({ updatedAt: -1 })
      .select('updatedAt')
      .lean();
    const targetDateKey = this._getBusinessDayContext(simData).businessDayKey;
    const cacheKey = this._buildForecastCacheKey({
      schoolId,
      targetDateKey,
      configFingerprint: this._buildForecastConfigFingerprint(config),
      latestInvoiceUpdatedAt: latestInvoice?.updatedAt || null,
    });
    const cachedForecast = this._getCachedForecast(cacheKey);
    if (cachedForecast) {
      return {
        ...cachedForecast,
        cache_hit: true,
      };
    }

    const invoices = await Invoice.find({
      school_id: schoolId,
      status: { $in: ['pending', 'overdue'] },
      dueDate: { $gte: limitPassado, $lte: futuroLimit },
    }).populate('student').populate('tutor');

    const forecast = {
      date: simData,
      total_expected: 0,
      breakdown: {
        due_today: 0,
        overdue: 0,
        reminder: 0,
        new_invoice: 0,
      },
      primary_channel_preview: config.primaryChannel || 'whatsapp',
      fallback_enabled: config.allowFallback === true,
      skipped_breakdown: {},
      cache_hit: false,
      generated_at: new Date(),
    };

    for (const invoice of invoices) {
      const analysis = await this._analyzeInvoiceForDispatch(invoice, {
        config,
        referenceDate: simData,
        checkDuplicates: false,
        validateTransportReady: false,
        requirePaymentData: true,
        includeHold: true,
        skipWindow: false,
      });

      if (!analysis.ok) {
        const reasonCode = analysis.outcome?.code || 'INTERNAL_ERROR';
        forecast.skipped_breakdown[reasonCode] = (forecast.skipped_breakdown[reasonCode] || 0) + 1;
        continue;
      }

        forecast.total_expected += 1;
        if (forecast.breakdown[analysis.type] !== undefined) {
          forecast.breakdown[analysis.type] += 1;
        }
      }

    this._setCachedForecast(cacheKey, forecast);
    return forecast;
  }

  async getTransportLogs(schoolId, filters = {}) {
    const safePage = Math.max(parseInt(filters.page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(parseInt(filters.limit, 10) || 20, 1), 100);
    const normalizedStatus = normalizeString(filters.status);
    const normalizedProviderStatus = normalizeString(filters.providerStatus);
    const normalizedProviderMessageId = normalizeString(filters.providerMessageId);
    const normalizedNotificationLogId = normalizeString(filters.notificationLogId);
    const normalizedInvoiceId = normalizeString(filters.invoiceId);
    const normalizedDestination = normalizeString(filters.destination);
    const normalizedInstanceName = normalizeString(filters.instanceName);
    const normalizedSource = normalizeString(filters.source);
    const normalizedChannel = normalizeString(filters.channel);

    const genericFilter = { school_id: schoolId };
    if (normalizedStatus) genericFilter.status = normalizedStatus;
    if (normalizedProviderStatus) genericFilter.provider_status = normalizedProviderStatus;
    if (normalizedProviderMessageId) genericFilter.provider_message_id = normalizedProviderMessageId;
    if (normalizedNotificationLogId) genericFilter.notification_log_id = normalizedNotificationLogId;
    if (normalizedInvoiceId) genericFilter.invoice_id = normalizedInvoiceId;
    if (normalizedChannel) genericFilter.channel = normalizedChannel;
    if (normalizedDestination) {
      genericFilter.$or = [
        { destination: normalizedDestination },
        { destination_phone_normalized: normalizedDestination.replace(/\D/g, '') },
        { destination_email_normalized: normalizedDestination.toLowerCase() },
      ];
    }
    if (normalizedInstanceName) genericFilter.instance_name = normalizedInstanceName;
    if (normalizedSource) genericFilter.source = normalizedSource;

    const legacyFilter = { school_id: schoolId };
    if (normalizedStatus) legacyFilter.status = normalizedStatus;
    if (normalizedProviderStatus) legacyFilter.provider_status = normalizedProviderStatus.toUpperCase();
    if (normalizedProviderMessageId) legacyFilter.provider_message_id = normalizedProviderMessageId;
    if (normalizedDestination) legacyFilter.destination = normalizedDestination;
    if (normalizedInstanceName) legacyFilter.instance_name = normalizedInstanceName;
    if (normalizedSource) legacyFilter.source = normalizedSource;
    if (normalizedNotificationLogId) legacyFilter['metadata.notification_log_id'] = normalizedNotificationLogId;
    if (normalizedInvoiceId) legacyFilter['metadata.invoice_id'] = normalizedInvoiceId;

    const [genericLogs, legacyLogs] = await Promise.all([
      NotificationTransportLog.find(genericFilter).sort({ last_event_at: -1, createdAt: -1 }).lean(),
      normalizedChannel && normalizedChannel !== 'whatsapp'
        ? Promise.resolve([])
        : WhatsappTransportLog.find(legacyFilter).sort({ last_event_at: -1, createdAt: -1 }).lean(),
    ]);

    const mappedLegacyLogs = legacyLogs.map((log) => ({
      ...log,
      channel: 'whatsapp',
      provider: 'evolution',
      canonical_status:
        log.status === 'accepted_by_evolution' ? 'accepted' :
        log.status === 'server_ack' ? 'sent' :
        log.status === 'deleted' ? 'cancelled' :
        log.status,
      notification_log_id: log.metadata?.notification_log_id || null,
      invoice_id: log.metadata?.invoice_id || null,
      attempt_number: Number(log.attempts || 1),
      destination_phone: log.destination || null,
      destination_email: null,
      provider_thread_id: null,
    }));

    const merged = [...genericLogs, ...mappedLegacyLogs].sort((left, right) => {
      const leftTs = normalizeDate(left.last_event_at || left.createdAt)?.getTime() || 0;
      const rightTs = normalizeDate(right.last_event_at || right.createdAt)?.getTime() || 0;
      return rightTs - leftTs;
    });

    return {
      logs: merged.slice((safePage - 1) * safeLimit, safePage * safeLimit),
      total: merged.length,
      page: safePage,
      pages: Math.max(Math.ceil(merged.length / safeLimit), 1),
    };
  }

  async retryAllFailed(schoolId, dateStr) {
    const { startOfDay, endOfDay } = this._getDayRange(dateStr);
    const failedLogs = await NotificationLog.find({
      school_id: schoolId,
      status: 'failed',
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });

    let count = 0;
    for (const log of failedLogs) {
      await notificationLogService.markQueued(log._id, {
        scheduledFor: new Date(),
        dispatchOrigin: 'manual_retry',
      });
      count += 1;
    }

    return {
      count,
      message: count === 0
        ? 'Nenhuma falha encontrada no dia selecionado.'
        : `${count} mensagens enviadas para a fila novamente.`,
    };
  }

  async getConfig(schoolId) {
    let config = await NotificationConfig.findOne({ school_id: schoolId });
    if (!config) config = await NotificationConfig.create({ school_id: schoolId });
    return config;
  }

  async saveConfig(schoolId, data = {}) {
    const current = await this.getConfig(schoolId);
    const currentObject = current.toObject ? current.toObject() : current;

    const payload = {
      ...currentObject,
      ...data,
      school_id: schoolId,
      channels: {
        ...(currentObject.channels || {}),
        ...(data.channels || {}),
        whatsapp: {
          ...((currentObject.channels || {}).whatsapp || {}),
          ...((data.channels || {}).whatsapp || {}),
        },
        email: {
          ...((currentObject.channels || {}).email || {}),
          ...((data.channels || {}).email || {}),
        },
      },
    };

    delete payload._id;
    delete payload.createdAt;
    delete payload.updatedAt;
    delete payload.__v;

    const savedConfig = await NotificationConfig.findOneAndUpdate(
      { school_id: schoolId },
      payload,
      { new: true, upsert: true, runValidators: true }
    );
    this.invalidateForecastCache({ schoolId });
    return savedConfig;
  }
}

const service = new NotificationService();

module.exports = service;
module.exports.NotificationService = NotificationService;
