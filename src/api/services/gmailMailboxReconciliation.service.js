const GmailProvider = require('../providers/gmail.provider');
const NotificationTransportLog = require('../models/notification_transport_log.model');
const NotificationConfig = require('../models/notification-config.model');
const EmailMailboxEvent = require('../models/email_mailbox_event.model');
const notificationTransportLogService = require('./notificationTransportLog.service');
const notificationLogService = require('./notificationLog.service');
const { parseBounceMessage } = require('../utils/gmailMailboxParser.util');

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

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

class GmailMailboxReconciliationService {
  constructor({
    gmailProvider = new GmailProvider(),
    NotificationTransportLogModel = NotificationTransportLog,
    NotificationConfigModel = NotificationConfig,
    EmailMailboxEventModel = EmailMailboxEvent,
    notificationTransportLogService: transportService = notificationTransportLogService,
    notificationLogService: logService = notificationLogService,
  } = {}) {
    this.gmailProvider = gmailProvider;
    this.NotificationTransportLogModel = NotificationTransportLogModel;
    this.NotificationConfigModel = NotificationConfigModel;
    this.EmailMailboxEventModel = EmailMailboxEventModel;
    this.notificationTransportLogService = transportService;
    this.notificationLogService = logService;
  }

  _emitNotificationUpdated(log) {
    if (appEmitter?.emit) {
      appEmitter.emit('notification:updated', log);
    }
  }

  async _findMatchingAttempt({ schoolId = null, internetMessageId = null, destinationEmail = null }) {
    if (internetMessageId) {
      const matchByMessageId = await this.NotificationTransportLogModel.findOne({
        ...(schoolId ? { school_id: schoolId } : {}),
        channel: 'email',
        internet_message_id: internetMessageId,
      }).sort({ last_event_at: -1, createdAt: -1 });

      if (matchByMessageId) return matchByMessageId;
    }

    if (!destinationEmail) return null;

    return this.NotificationTransportLogModel.findOne({
      ...(schoolId ? { school_id: schoolId } : {}),
      channel: 'email',
      destination_email_normalized: normalizeEmail(destinationEmail),
      canonical_status: { $in: ['accepted', 'sent', 'delivered', 'read', 'failed'] },
    }).sort({ last_event_at: -1, createdAt: -1 });
  }

  async _markSchoolMailboxSync(schoolId, syncedAt = new Date()) {
    if (!schoolId) return;

    await this.NotificationConfigModel.updateOne(
      { school_id: schoolId },
      {
        $set: {
          'channels.email.lastMailboxSyncAt': syncedAt,
        },
      }
    );
  }

  async reconcile({ schoolId = null, maxMessages = 25 } = {}) {
    try {
      const mailbox = await this.gmailProvider.listMailboxMessages({
        query: 'newer_than:7d (from:mailer-daemon OR from:"Mail Delivery Subsystem" OR subject:"Delivery Status Notification" OR subject:Undelivered OR subject:"Address not found" OR subject:"delivery incomplete")',
        maxResults,
      });

      const summary = {
        processed: 0,
        matched: 0,
        bounced: 0,
        unmatched: 0,
        ignored: 0,
      };

      for (const item of mailbox.messages || []) {
        const alreadyProcessed = await this.EmailMailboxEventModel.findOne({
          gmail_message_id: item.id,
        }).select('_id').lean();

        if (alreadyProcessed) {
          summary.ignored += 1;
          continue;
        }

        const message = await this.gmailProvider.getMailboxMessage(item.id, 'full');
        const parsed = parseBounceMessage(message);
        summary.processed += 1;

        if (!parsed.isBounce) {
          await this.EmailMailboxEventModel.create({
            provider: 'gmail',
            gmail_message_id: item.id,
            gmail_thread_id: item.threadId || null,
            classification: 'ignored_non_bounce',
            detected_at: parsed.detectedAt || new Date(),
            subject: parsed.subject,
            snippet: parsed.snippet,
            raw_headers: parsed.headers,
            raw_payload: message,
            metadata: {
              reason_code: null,
            },
          });
          summary.ignored += 1;
          continue;
        }

        const attempt = await this._findMatchingAttempt({
          schoolId,
          internetMessageId: parsed.internetMessageId,
          destinationEmail: parsed.destinationEmail,
        });

        if (!attempt) {
          await this.EmailMailboxEventModel.create({
            provider: 'gmail',
            gmail_message_id: item.id,
            gmail_thread_id: item.threadId || null,
            classification: parsed.classification.code,
            detected_at: parsed.detectedAt || new Date(),
            subject: parsed.subject,
            snippet: parsed.snippet,
            raw_headers: parsed.headers,
            raw_payload: message,
            internet_message_id: parsed.internetMessageId,
            destination_email: parsed.destinationEmail,
            metadata: {
              matched: false,
              reason_code: parsed.classification.code,
              reason_message: parsed.classification.message,
            },
          });
          summary.unmatched += 1;
          continue;
        }

        const bouncedAttempt = await this.notificationTransportLogService.markBounced(attempt._id, {
          providerMailboxEventId: item.id,
          providerMessageId: attempt.provider_message_id || null,
          internetMessageId: attempt.internet_message_id || parsed.internetMessageId || null,
          providerThreadId: attempt.provider_thread_id || item.threadId || null,
          providerStatus: parsed.classification.code,
          destination: attempt.destination || parsed.destinationEmail || null,
          destinationEmail: attempt.destination_email || parsed.destinationEmail || null,
          errorMessage: parsed.classification.message,
          errorCode: parsed.classification.code,
          rawLastWebhookPayload: message,
          eventAt: parsed.detectedAt || new Date(),
          source: 'gmail.mailbox_reconciliation',
        });

        let failedLog = null;
        if (attempt.notification_log_id) {
          failedLog = await this.notificationLogService.markFailed(attempt.notification_log_id, {
            errorMessage: parsed.classification.message,
            errorCode: parsed.classification.code,
            errorHttpStatus: 422,
            errorRaw: JSON.stringify({
              gmail_message_id: item.id,
              subject: parsed.subject,
              snippet: parsed.snippet,
            }).slice(0, 2000),
            transportLog: bouncedAttempt,
            failedAt: parsed.detectedAt || new Date(),
          });
          this._emitNotificationUpdated(failedLog);
        }

        await this.EmailMailboxEventModel.create({
          provider: 'gmail',
          gmail_message_id: item.id,
          gmail_thread_id: item.threadId || null,
          school_id: attempt.school_id || null,
          notification_log_id: attempt.notification_log_id || null,
          notification_transport_log_id: attempt._id,
          internet_message_id: attempt.internet_message_id || parsed.internetMessageId || null,
          destination_email: attempt.destination_email || parsed.destinationEmail || null,
          classification: parsed.classification.code,
          detected_at: parsed.detectedAt || new Date(),
          subject: parsed.subject,
          snippet: parsed.snippet,
          raw_headers: parsed.headers,
          raw_payload: message,
          metadata: {
            matched: true,
            reason_code: parsed.classification.code,
            reason_message: parsed.classification.message,
            notification_log_status: failedLog?.status || null,
          },
        });

        await this._markSchoolMailboxSync(attempt.school_id, new Date());
        summary.matched += 1;
        summary.bounced += 1;
      }

      return summary;
    } catch (error) {
      if (error.code === 'GMAIL_READ_SCOPE_MISSING') {
        return {
          processed: 0,
          matched: 0,
          bounced: 0,
          unmatched: 0,
          ignored: 0,
          skipped: true,
          reason: error.code,
        };
      }

      throw error;
    }
  }
}

const service = new GmailMailboxReconciliationService();

module.exports = service;
module.exports.GmailMailboxReconciliationService = GmailMailboxReconciliationService;
