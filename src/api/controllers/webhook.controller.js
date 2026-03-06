const InvoiceService = require('../services/invoice.service');
const NegotiationService = require('../services/negotiation.service');
const WhatsappBotService = require('../services/whatsappBot.service');
const School = require('../models/school.model');
const appEmitter = require('../../loaders/eventEmitter');

class WebhookController {
  /**
   * [WHATSAPP] Webhook da Evolution API
   */
 async handleWhatsappWebhook(req, res) {

  console.log('==============================');
  console.log('📩 WEBHOOK WHATSAPP RECEBIDO');
  console.log('BODY:', JSON.stringify(req.body, null, 2));
  console.log('==============================');

  try {

    res.status(200).json({ status: 'recebido' });

    const { event, data, instance, instanceName } = req.body || {};

    console.log('📌 Event:', event);
    console.log('📌 Instance:', instance);
    console.log('📌 InstanceName:', instanceName);

    if (!data) {
      console.log('⚠️ Payload sem data');
      return;
    }

    console.log('📦 DATA:', JSON.stringify(data, null, 2));

    if (data.key?.fromMe) {
      console.log('↩️ Mensagem enviada pelo próprio bot. Ignorando.');
      return;
    }

    const remoteJid =
      data?.key?.remoteJid ||
      data?.key?.participant ||
      data?.key?.id ||
      '';

    console.log('📱 remoteJid:', remoteJid);

    const phone = String(remoteJid)
      .replace(/@.*/, '')
      .replace(/\D/g, '');

    console.log('📞 phone extraído:', phone);

    const messageText =
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      data?.message?.imageMessage?.caption ||
      data?.message?.videoMessage?.caption ||
      data?.message?.documentMessage?.caption ||
      '';

    console.log('💬 messageText:', messageText);

    if (!messageText) {
      console.log('⚠️ Mensagem sem texto');
      return;
    }

  } catch (error) {

    console.error('❌ ERRO NO WEBHOOK:', error);

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