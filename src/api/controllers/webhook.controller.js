const InvoiceService = require('../services/invoice.service');
const NegotiationService = require('../services/negotiation.service');
const WhatsappBotService = require('../services/whatsappBot.service');
const WhatsappTransportLog = require('../models/whatsapp_transport_log.model');
const NotificationTransportLog = require('../models/notification_transport_log.model');
const School = require('../models/school.model');
const notificationTransportLogService = require('../services/notificationTransportLog.service');
const appEmitter = require('../../loaders/eventEmitter');

class WebhookController {
  _safeJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '[unserializable]';
    }
  }

  _normalizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  _firstNonEmpty(values = []) {
    for (const value of values) {
      const normalized = this._normalizeText(value);
      if (normalized) return normalized;
    }
    return '';
  }

  _normalizeEventName(event) {
    return String(event || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  _toDate(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'number') {
      const normalized = value < 1e12 ? value * 1000 : value;
      const parsed = new Date(normalized);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  _isTransportStatusEvent(eventSlug = '') {
    return new Set(['send_message', 'messages_update', 'messages_delete']).has(eventSlug);
  }

  _extractTransportMessageFields({ event, data, body, instanceName, sender }) {
    const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const key = payload?.key || {};

    const providerMessageId =
      key.id ||
      payload?.keyId ||
      payload?.messageId ||
      payload?.id ||
      null;

    const remoteJid =
      key.remoteJid ||
      payload?.remoteJid ||
      payload?.destination ||
      payload?.jid ||
      payload?.from ||
      payload?.participant ||
      sender ||
      null;

    const destination = this._extractPhone(remoteJid);
    const instanceId = payload?.instanceId || payload?.instance?.id || body?.instanceId || null;
    const providerStatus = this._firstNonEmpty([
      payload?.status,
      payload?.update?.status,
      payload?.messageStatus,
      body?.status,
    ]);
    const providerMessageTimestamp = this._toDate(
      payload?.messageTimestamp || body?.messageTimestamp || body?.timestamp || null
    );
    const eventAt = this._toDate(body?.date_time || body?.timestamp || payload?.date_time || payload?.timestamp) || new Date();

    return {
      providerMessageId,
      remoteJid,
      destination,
      instanceId,
      providerStatus,
      providerMessageTimestamp,
      eventAt,
      instanceName,
      event,
    };
  }

  _extractMessageText(data = {}) {
    let msg = data?.message || {};

    while (
      msg.ephemeralMessage?.message ||
      msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message ||
      msg.documentWithCaptionMessage?.message
    ) {
      msg =
        msg.ephemeralMessage?.message ||
        msg.viewOnceMessage?.message ||
        msg.viewOnceMessageV2?.message ||
        msg.documentWithCaptionMessage?.message;
    }

    return this._firstNonEmpty([
      msg?.conversation,
      msg?.extendedTextMessage?.text,
      msg?.imageMessage?.caption,
      msg?.videoMessage?.caption,
      msg?.documentMessage?.caption,
      msg?.buttonsResponseMessage?.selectedButtonId,
      msg?.buttonsResponseMessage?.selectedDisplayText,
      msg?.listResponseMessage?.title,
      msg?.listResponseMessage?.singleSelectReply?.selectedRowId,
      msg?.templateButtonReplyMessage?.selectedId,
      msg?.templateButtonReplyMessage?.selectedDisplayText,
      msg?.interactiveResponseMessage?.body?.text,
      data?.text,
      data?.body,
      data?.content,
      data?.caption,
    ]);
  }

  _extractRemoteJid(data = {}, sender = '') {
    return this._firstNonEmpty([
      data?.key?.remoteJidAlt,
      data?.key?.remoteJid,
      data?.key?.participant,
      data?.remoteJidAlt,
      data?.remoteJid,
      data?.participant,
      data?.jid,
      data?.from,
      data?.sender,
      sender,
    ]);
  }

  _extractPhone(remoteJid = '') {
    const jid = String(remoteJid || '');

    if (jid.includes('@lid')) {
      return jid;
    }

    const cleanJid = jid.split('@')[0].split(':')[0];
    return cleanJid.replace(/\D/g, '');
  }

  _normalizeProviderStatus(value = '') {
    return String(value || '').trim().toUpperCase();
  }

  async _findGenericTransportAttempt({ schoolId, legacyTransportLog, providerMessageId }) {
    const legacyAttemptId = legacyTransportLog?.metadata?.transport_attempt_id || null;

    if (legacyAttemptId) {
      const byId = await NotificationTransportLog.findById(legacyAttemptId);
      if (byId) return byId;
    }

    if (!providerMessageId) return null;

    return NotificationTransportLog.findOne({
      school_id: schoolId,
      provider: 'evolution',
      provider_message_id: providerMessageId,
    }).sort({ attempt_number: -1, last_event_at: -1 });
  }

  async _syncGenericTransportAttempt({
    schoolId,
    transportInfo,
    legacyTransportLog,
    rawWebhookPayload,
    eventSlug,
  }) {
    const attempt = await this._findGenericTransportAttempt({
      schoolId,
      legacyTransportLog,
      providerMessageId: transportInfo.providerMessageId,
    });

    if (!attempt) return null;

    const providerStatus = this._normalizeProviderStatus(transportInfo.providerStatus);
    const transitionPayload = {
      providerMessageId: transportInfo.providerMessageId,
      providerStatus: providerStatus || null,
      destination: transportInfo.destination || null,
      destinationPhone: transportInfo.destination || null,
      instanceName: transportInfo.instanceName || null,
      instanceId: transportInfo.instanceId || null,
      remoteJid: transportInfo.remoteJid || null,
      eventAt: transportInfo.eventAt || new Date(),
      eventType: (eventSlug || 'webhook_event').toUpperCase(),
      rawLastWebhookPayload: rawWebhookPayload || null,
      source: 'evolution.webhook',
      metadata: {
        hook_event_slug: eventSlug || null,
        hook_provider_status: providerStatus || null,
      },
    };

    if (providerStatus === 'READ') {
      return notificationTransportLogService.markRead(attempt._id, transitionPayload);
    }

    if (providerStatus === 'DELIVERY_ACK') {
      return notificationTransportLogService.markDelivered(attempt._id, transitionPayload);
    }

    if (providerStatus === 'SERVER_ACK') {
      return notificationTransportLogService.markSent(attempt._id, transitionPayload);
    }

    if (providerStatus === 'ERROR') {
      return notificationTransportLogService.markFailed(attempt._id, {
        ...transitionPayload,
        errorMessage: 'Falha reportada pelo provider WhatsApp.',
        errorCode: 'WHATSAPP_PROVIDER_ERROR',
      });
    }

    if (providerStatus === 'DELETED' || eventSlug === 'messages_delete') {
      return notificationTransportLogService.markCancelled(attempt._id, transitionPayload);
    }

    return notificationTransportLogService.markAccepted(attempt._id, transitionPayload);
  }

  async _resolveSchoolByInstance(resolvedInstanceName, hookRunId) {
    console.log(
      `[${hookRunId}] Trying to resolve school by whatsapp.instanceName=${resolvedInstanceName}`
    );

    let school = await School.findOne({
      'whatsapp.instanceName': resolvedInstanceName,
    }).select('_id name whatsapp');

    if (!school && String(resolvedInstanceName).startsWith('school_')) {
      const possibleSchoolId = String(resolvedInstanceName).replace('school_', '');

      console.log(
        `[${hookRunId}] No school by instanceName. Trying fallback by _id=${possibleSchoolId}`
      );

      try {
        school = await School.findById(possibleSchoolId).select('_id name whatsapp');
      } catch (fallbackError) {
        console.warn(
          `[${hookRunId}] Fallback by _id failed for ${resolvedInstanceName}: ${fallbackError.message}`
        );
      }
    }

    if (school) {
      console.log(
        `[${hookRunId}] School found | schoolId=${school._id} | name=${school.name || 'No name'} | db.instanceName=${
          school.whatsapp?.instanceName || 'N/A'
        } | db.status=${school.whatsapp?.status || 'N/A'}`
      );
    }

    return school;
  }

  /**
   * [WHATSAPP] Webhook da Evolution API
   */
  async handleWhatsappWebhook(req, res) {
    const hookRunId = `wa-${Date.now()}`;

    try {
      const { event, data, instance, instanceName, sender } = req.body || {};

      const resolvedInstanceName =
        instance ||
        instanceName ||
        data?.instance ||
        data?.qrcode?.instance ||
        req.body?.instance ||
        req.body?.instanceName ||
        null;

      console.log(
        `[${hookRunId}] WhatsApp webhook received | event=${event || 'N/A'} | instance=${
          resolvedInstanceName || 'N/A'
        }`
      );

      if (!resolvedInstanceName) {
        console.warn(`[${hookRunId}] WhatsApp webhook without identifiable instanceName.`);
        res.status(200).json({ status: 'recebido' });
        return;
      }

      const school = await this._resolveSchoolByInstance(resolvedInstanceName, hookRunId);

      if (!school) {
        console.warn(`[${hookRunId}] No school found for instance: ${resolvedInstanceName}`);
        res.status(200).json({ status: 'recebido' });
        return;
      }

      const evtSlug = this._normalizeEventName(event);

      if (this._isTransportStatusEvent(evtSlug)) {
        try {
          const transportInfo = this._extractTransportMessageFields({
            event,
            data,
            body: req.body || {},
            instanceName: resolvedInstanceName,
            sender,
          });

          const legacyTransportLog = await WhatsappTransportLog.recordWebhookEvent({
            schoolId: school._id,
            instanceName: resolvedInstanceName,
            instanceId: transportInfo.instanceId,
            providerMessageId: transportInfo.providerMessageId,
            remoteJid: transportInfo.remoteJid,
            destination: transportInfo.destination,
            providerStatus: transportInfo.providerStatus,
            providerMessageTimestamp: transportInfo.providerMessageTimestamp,
            eventType: event,
            eventAt: transportInfo.eventAt,
            rawWebhookPayload: req.body || {},
            source: 'evolution.webhook',
            metadata: {
              hook_run_id: hookRunId,
              sender: sender || null,
              event_slug: evtSlug,
            },
          });

          await this._syncGenericTransportAttempt({
            schoolId: school._id,
            transportInfo,
            legacyTransportLog,
            rawWebhookPayload: req.body || {},
            eventSlug: evtSlug,
          });

          await School.findByIdAndUpdate(school._id, {
            'whatsapp.instanceName': resolvedInstanceName,
            'whatsapp.lastSyncAt': new Date(),
            'whatsapp.lastError': null,
          });

          res.status(200).json({ status: 'recebido' });
          return;
        } catch (error) {
          console.error(`[${hookRunId}] Failed to persist transport event:`, error.message);
          if (!res.headersSent) {
            res.status(500).json({
              status: 'erro',
              message: 'Falha ao persistir evento de status.',
            });
          }
          return;
        }
      }

      res.status(200).json({ status: 'recebido' });

      if (evtSlug === 'connection_update') {
        const state = data?.state || 'disconnected';

        const update = {
          'whatsapp.instanceName': resolvedInstanceName,
          'whatsapp.lastSyncAt': new Date(),
          'whatsapp.lastError': null,
        };

        if (state === 'open') {
          update['whatsapp.status'] = 'connected';
          update['whatsapp.qrCode'] = null;
          update['whatsapp.connectedPhone'] = data?.wuid || sender || null;
          update['whatsapp.profileName'] = data?.profileName || null;
          update['whatsapp.lastConnectedAt'] = new Date();
        } else if (state === 'connecting') {
          update['whatsapp.status'] = 'connecting';
        } else {
          update['whatsapp.status'] = 'disconnected';
          update['whatsapp.lastDisconnectedAt'] = new Date();
        }

        await School.findByIdAndUpdate(school._id, update);

        console.log(`[${hookRunId}] connection.update processed | schoolId=${school._id} | state=${state}`);
        return;
      }

      if (evtSlug === 'qrcode_updated') {
        await School.findByIdAndUpdate(school._id, {
          'whatsapp.instanceName': resolvedInstanceName,
          'whatsapp.status': 'qr_pending',
          'whatsapp.qrCode': data?.qrcode?.base64 || null,
          'whatsapp.lastSyncAt': new Date(),
          'whatsapp.lastError': null,
        });

        console.log(
          `[${hookRunId}] qrcode.updated processed | schoolId=${school._id} | instance=${resolvedInstanceName}`
        );
        return;
      }

      if (evtSlug === 'chats_update') {
        const updates = Array.isArray(data) ? data : [data];

        for (const update of updates) {
          if (update && update.unreadCount > 0) {
            const remoteJid = update.id || update.jid;
            if (!remoteJid) continue;

            const phone = this._extractPhone(remoteJid);

            console.log(
              `[${hookRunId}] Chat marked as unread | phone=${phone}. Restarting bot...`
            );

            await WhatsappBotService.handleIncomingMessage({
              schoolId: school._id,
              phone,
              messageText: 'reiniciar',
              instanceName: resolvedInstanceName,
            });
          }
        }
        return;
      }

      if (evtSlug !== 'messages_upsert') {
        return;
      }

      console.log(
        `[${hookRunId}] messages.upsert detected | schoolId=${school._id} | instance=${resolvedInstanceName}`
      );

      if (!data?.key) {
        console.warn(`[${hookRunId}] messages.upsert without data.key`);
        return;
      }

      if (data?.key?.fromMe === true) {
        console.log(`[${hookRunId}] Outbound message from the same instance. Ignoring.`);
        return;
      }

      const remoteJid = this._extractRemoteJid(data, sender);

      if (remoteJid && (remoteJid.includes('@g.us') || remoteJid.includes('status@broadcast'))) {
        console.log(`[${hookRunId}] Group/status message ignored: ${remoteJid}`);
        return;
      }

      const phone = this._extractPhone(remoteJid);

      if (!phone) {
        console.warn(`[${hookRunId}] WhatsApp webhook without identifiable phone.`);
        return;
      }

      const providerMessageId =
        data?.key?.id ||
        data?.keyId ||
        data?.id ||
        data?.messageId ||
        null;

      const messageText = this._extractMessageText(data);

      if (!messageText || !String(messageText).trim()) {
        console.warn(`[${hookRunId}] Message without processable text | phone=${phone}`);
        return;
      }

      await School.findByIdAndUpdate(school._id, {
        'whatsapp.instanceName': resolvedInstanceName,
        'whatsapp.status': 'connected',
        'whatsapp.lastSyncAt': new Date(),
        'whatsapp.lastError': null,
      });

      console.log(
        `[${hookRunId}] Forwarding message to bot | phone=${phone} | text="${messageText}"`
      );

      await WhatsappBotService.handleIncomingMessage({
        schoolId: school._id,
        phone,
        messageText,
        instanceName: resolvedInstanceName,
        providerMessageId,
        remoteJid,
      });

      console.log(
        `[${hookRunId}] Message processed by bot | schoolId=${school._id} | phone=${phone}`
      );
    } catch (error) {
      console.error(`[Webhook WhatsApp ${hookRunId}] Error:`, error.message);
      console.error(error.stack);
      if (!res.headersSent) {
        res.status(500).json({ status: 'erro' });
      }
    }
  }

  async handleMpWebhook(req, res) {
    const hookRunId = `mp-${Date.now()}`;
    console.log(`--- WEBHOOK MERCADO PAGO RECEBIDO (${hookRunId}) ---`);

    res.status(200).json({ status: 'recebido' });

    const paymentId = req.query['data.id'] || req.body?.data?.id;

    if (!paymentId) {
      console.log(`[${hookRunId}] Evento MP sem paymentId (ignorando). query=`, req.query);
      return;
    }

    try {
      const invResult = await InvoiceService.handlePaymentWebhook(paymentId, 'MERCADO_PAGO', null);

      if (invResult.processed) {
        this._emitEvents(invResult.invoice, 'invoice');
        return;
      }

      const negResult = await NegotiationService.handlePaymentWebhook(paymentId);

      if (negResult.processed) {
        this._emitEvents(negResult.negotiation, 'negotiation');
        return;
      }
    } catch (error) {
      console.error(`[${hookRunId}] Error processing MP webhook:`, error.message);
    }
  }

  async handleCoraWebhook(req, res) {
    const hookRunId = `cora-${Date.now()}`;
    res.status(200).send('OK');
    console.log(`--- WEBHOOK CORA RECEIVED (${hookRunId}) ---`);

    const headers = req.headers || {};
    const eventType =
      headers['webhook-event-type'] ||
      headers['x-webhook-event-type'] ||
      headers['x-cora-webhook-event-type'] ||
      headers['event-type'] ||
      null;
    const resourceId =
      headers['webhook-resource-id'] ||
      headers['x-webhook-resource-id'] ||
      headers['x-cora-webhook-resource-id'] ||
      headers['resource-id'] ||
      null;
    const bodyEventType = req.body?.eventType || req.body?.event_type || req.body?.type || req.body?.event || null;
    const bodyResourceId = req.body?.resourceId || req.body?.resource_id || req.body?.id || req.body?.data?.id || null;

    const finalEventType = eventType || bodyEventType;
    const finalResourceId = resourceId || bodyResourceId;

    if (!finalEventType || !finalResourceId) return;

    let statusRaw = null;
    const evt = String(finalEventType).toLowerCase();

    if (evt === 'invoice.paid' || evt === 'bank_slip.liquidation' || evt === 'bankslip.liquidation') {
      statusRaw = 'paid';
    } else if (evt === 'invoice.canceled' || evt === 'invoice.cancelled') {
      statusRaw = 'cancelled';
    } else {
      return;
    }

    try {
      const invResult = await InvoiceService.handlePaymentWebhook(finalResourceId, 'CORA', statusRaw);
      if (invResult.processed) {
        this._emitEvents(invResult.invoice, 'invoice');
      }
    } catch (error) {
      console.error(`Error processing Cora webhook:`, error.message);
    }
  }

  _emitEvents(document, type) {
    if (!document) return;

    const status = document.status;
    const eventBase = type === 'negotiation' ? 'negotiation' : 'invoice';

    if (status === 'paid') {
      appEmitter.emit(`${eventBase}:paid`, document);
    } else {
      appEmitter.emit(`${eventBase}:updated`, document);
    }
  }
}

module.exports = new WebhookController();
