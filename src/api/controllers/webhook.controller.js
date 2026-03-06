const InvoiceService = require('../services/invoice.service');
const NegotiationService = require('../services/negotiation.service');
const WhatsappBotService = require('../services/whatsappBot.service');
const School = require('../models/school.model');
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

  _extractMessageText(data = {}) {
    return this._firstNonEmpty([
      data?.message?.conversation,
      data?.message?.extendedTextMessage?.text,
      data?.message?.imageMessage?.caption,
      data?.message?.videoMessage?.caption,
      data?.message?.documentMessage?.caption,
      data?.message?.buttonsResponseMessage?.selectedButtonId,
      data?.message?.buttonsResponseMessage?.selectedDisplayText,
      data?.message?.listResponseMessage?.title,
      data?.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      data?.message?.templateButtonReplyMessage?.selectedId,
      data?.message?.templateButtonReplyMessage?.selectedDisplayText,
      data?.message?.interactiveResponseMessage?.body?.text,
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
    return String(remoteJid || '')
      .replace(/@.*/, '')
      .replace(/\D/g, '');
  }

  async _resolveSchoolByInstance(resolvedInstanceName, hookRunId) {
    console.log(
      `🔎 [${hookRunId}] Tentando resolver escola por whatsapp.instanceName=${resolvedInstanceName}`
    );

    let school = await School.findOne({
      'whatsapp.instanceName': resolvedInstanceName,
    }).select('_id name whatsapp');

    if (!school && String(resolvedInstanceName).startsWith('school_')) {
      const possibleSchoolId = String(resolvedInstanceName).replace('school_', '');

      console.log(
        `🧪 [${hookRunId}] Nenhuma escola por instanceName. Tentando fallback por _id=${possibleSchoolId}`
      );

      try {
        school = await School.findById(possibleSchoolId).select('_id name whatsapp');
      } catch (fallbackError) {
        console.warn(
          `⚠️ [${hookRunId}] Falha no fallback por _id para ${resolvedInstanceName}: ${fallbackError.message}`
        );
      }
    }

    if (school) {
      console.log(
        `✅ [${hookRunId}] Escola encontrada | schoolId=${school._id} | nome=${school.name || 'Sem nome'} | db.instanceName=${school.whatsapp?.instanceName || 'N/A'} | db.status=${school.whatsapp?.status || 'N/A'}`
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
      res.status(200).json({ status: 'recebido' });

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
        `📩 [${hookRunId}] Webhook WhatsApp recebido | event=${event || 'N/A'} | instance=${resolvedInstanceName || 'N/A'}`
      );

      if (!resolvedInstanceName) {
        console.warn(`⚠️ [${hookRunId}] Webhook WhatsApp sem instanceName identificável.`);
        console.warn(`🧪 [${hookRunId}] Body completo: ${this._safeJson(req.body)}`);
        return;
      }

      const school = await this._resolveSchoolByInstance(resolvedInstanceName, hookRunId);

      if (!school) {
        console.warn(
          `⚠️ [${hookRunId}] Nenhuma escola encontrada para a instância: ${resolvedInstanceName}`
        );
        console.warn(`🧪 [${hookRunId}] Body completo: ${this._safeJson(req.body)}`);
        return;
      }

      console.log(
        `🏫 [${hookRunId}] Escola resolvida | schoolId=${school._id} | nome=${school.name || 'Sem nome'} | instance=${resolvedInstanceName}`
      );

      const evtNormalizado = String(event || '').toLowerCase();

      if (evtNormalizado === 'connection.update') {
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

        console.log(
          `🔄 [${hookRunId}] connection.update processado | schoolId=${school._id} | state=${state}`
        );
        return;
      }

      if (evtNormalizado === 'qrcode.updated') {
        await School.findByIdAndUpdate(school._id, {
          'whatsapp.instanceName': resolvedInstanceName,
          'whatsapp.status': 'qr_pending',
          'whatsapp.qrCode': data?.qrcode?.base64 || null,
          'whatsapp.lastSyncAt': new Date(),
          'whatsapp.lastError': null,
        });

        console.log(
          `🧾 [${hookRunId}] qrcode.updated processado | schoolId=${school._id} | instance=${resolvedInstanceName}`
        );
        return;
      }

      if (evtNormalizado !== 'messages.upsert') {
        console.log(
          `ℹ️ [${hookRunId}] Evento WhatsApp ignorado | event=${event} | instance=${resolvedInstanceName}`
        );
        return;
      }

      console.log(
        `💬 [${hookRunId}] messages.upsert detectado | schoolId=${school._id} | instance=${resolvedInstanceName}`
      );

      if (!data?.key) {
        console.warn(`⚠️ [${hookRunId}] messages.upsert sem data.key`);
        console.warn(`🧪 [${hookRunId}] Payload data: ${this._safeJson(data)}`);
        return;
      }

      if (data?.key?.fromMe === true) {
        console.log(`↩️ [${hookRunId}] Mensagem enviada pela própria instância. Ignorando.`);
        return;
      }

      const remoteJid = this._extractRemoteJid(data, sender);

      console.log(
        `📱 [${hookRunId}] remoteJid bruto | remoteJid=${remoteJid || 'N/A'}`
      );

      const phone = this._extractPhone(remoteJid);

      if (!phone) {
        console.warn(
          `⚠️ [${hookRunId}] Webhook WhatsApp sem telefone identificável | schoolId=${school._id} | instance=${resolvedInstanceName}`
        );
        console.warn(
          `🧪 [${hookRunId}] Payload data sem telefone: ${this._safeJson(data)}`
        );
        return;
      }

      const messageText = this._extractMessageText(data);

      console.log(
        `📝 [${hookRunId}] Mensagem recebida | schoolId=${school._id} | phone=${phone} | text="${messageText || 'VAZIO'}"`
      );

      if (!messageText || !String(messageText).trim()) {
        console.warn(
          `⚠️ [${hookRunId}] Mensagem sem texto processável | schoolId=${school._id} | phone=${phone}`
        );
        console.warn(
          `🧪 [${hookRunId}] Payload data sem texto: ${this._safeJson(data)}`
        );
        return;
      }

      await School.findByIdAndUpdate(school._id, {
        'whatsapp.instanceName': resolvedInstanceName,
        'whatsapp.status': 'connected',
        'whatsapp.lastSyncAt': new Date(),
        'whatsapp.lastError': null,
      });

      console.log(
        `🤖 [${hookRunId}] Encaminhando mensagem para o bot | schoolId=${school._id} | schoolName=${school.name || 'Sem nome'} | instance=${resolvedInstanceName} | phone=${phone} | text="${messageText}"`
      );

      await WhatsappBotService.handleIncomingMessage({
        schoolId: school._id,
        phone,
        messageText,
        instanceName: resolvedInstanceName,
      });

      console.log(
        `✅ [${hookRunId}] Mensagem processada pelo bot | schoolId=${school._id} | phone=${phone}`
      );
    } catch (error) {
      console.error(`❌ Erro no Webhook WhatsApp [${hookRunId}]:`, error.message);
      console.error(error.stack);
    }
  }

  /**
   * [MERCADO PAGO] Webhook
   */
  async handleMpWebhook(req, res) {
    const hookRunId = `mp-${Date.now()}`;
    console.log(`--- 🔔 WEBHOOK MERCADO PAGO RECEBIDO (${hookRunId}) ---`);

    res.status(200).json({ status: 'recebido' });

    const paymentId = req.query['data.id'] || req.body?.data?.id;

    if (!paymentId) {
      console.log(`ℹ️ [${hookRunId}] Evento MP sem paymentId (ignorando). query=`, req.query);
      return;
    }

    console.log(`📌 [${hookRunId}] paymentId=${paymentId}`);

    try {
      const invResult = await InvoiceService.handlePaymentWebhook(
        paymentId,
        'MERCADO_PAGO',
        null
      );

      if (invResult.processed) {
        this._emitEvents(invResult.invoice, 'invoice');
        return;
      }

      const negResult = await NegotiationService.handlePaymentWebhook(paymentId);

      if (negResult.processed) {
        this._emitEvents(negResult.negotiation, 'negotiation');
        return;
      }

      console.warn(
        `⚠️ [${hookRunId}] Webhook MP ${paymentId} não encontrado em Faturas nem Negociações.`
      );
    } catch (error) {
      console.error(
        `❌ [${hookRunId}] Erro processando Webhook MP ${paymentId}:`,
        error.message
      );
    }
  }

  /**
   * [CORA] Webhook
   */
  async handleCoraWebhook(req, res) {
    const hookRunId = `cora-${Date.now()}`;

    res.status(200).send('OK');

    console.log(`--- 🏦 WEBHOOK CORA RECEBIDO (${hookRunId}) ---`);

    const headers = req.headers || {};
    const headerKeys = Object.keys(headers);
    console.log(`🧾 [${hookRunId}] headerKeys=`, headerKeys);

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

    const bodyEventType =
      req.body?.eventType ||
      req.body?.event_type ||
      req.body?.type ||
      req.body?.event ||
      null;

    const bodyResourceId =
      req.body?.resourceId ||
      req.body?.resource_id ||
      req.body?.id ||
      req.body?.data?.id ||
      null;

    const finalEventType = eventType || bodyEventType;
    const finalResourceId = resourceId || bodyResourceId;

    console.log(`📡 [${hookRunId}] Evento=${finalEventType} | ID=${finalResourceId}`);

    if (!finalEventType || !finalResourceId) {
      console.warn(
        `⚠️ [${hookRunId}] Webhook Cora sem eventType/resourceId. bodyKeys=`,
        Object.keys(req.body || {})
      );
      console.warn(`⚠️ [${hookRunId}] body=`, req.body);
      return;
    }

    let statusRaw = null;
    const evt = String(finalEventType).toLowerCase();

    if (
      evt === 'invoice.paid' ||
      evt === 'bank_slip.liquidation' ||
      evt === 'bankslip.liquidation'
    ) {
      statusRaw = 'paid';
    } else if (evt === 'invoice.canceled' || evt === 'invoice.cancelled') {
      statusRaw = 'cancelled';
    } else {
      console.log(`ℹ️ [${hookRunId}] Evento Cora ignorado (não relevante): ${finalEventType}`);
      return;
    }

    try {
      const invResult = await InvoiceService.handlePaymentWebhook(
        finalResourceId,
        'CORA',
        statusRaw
      );

      if (invResult.processed) {
        this._emitEvents(invResult.invoice, 'invoice');
        console.log(
          `✅ [${hookRunId}] Webhook Cora processado. invoiceId=${invResult.invoice?._id} newStatus=${invResult.newStatus}`
        );
      } else {
        console.warn(
          `⚠️ [${hookRunId}] Webhook Cora ID ${finalResourceId} não encontrado no banco ou não processado.`
        );
      }
    } catch (error) {
      console.error(`❌ [${hookRunId}] Erro processando Webhook Cora:`, error.message);
    }
  }

  _emitEvents(document, type) {
    if (!document) return;

    const status = document.status;
    const eventBase = type === 'negotiation' ? 'negotiation' : 'invoice';

    if (status === 'paid') {
      appEmitter.emit(`${eventBase}:paid`, document);
      console.log(`📡 EVENTO: ${eventBase}:paid disparado.`);
    } else {
      appEmitter.emit(`${eventBase}:updated`, document);
      console.log(`📡 EVENTO: ${eventBase}:updated disparado.`);
    }
  }
}

module.exports = new WebhookController();