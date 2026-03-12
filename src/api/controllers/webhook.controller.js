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
    let msg = data?.message || {};

    // 🌟 CORREÇÃO AQUI: Desempacotar Mensagens Temporárias e ViewOnce.
    // Pais novos costumam cair na regra de "Mensagens Temporárias" padrão, 
    // o que esconde o texto verdadeiro dentro de wrappers.
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
    
    // Se for uma conta comercial vinculada oculta, mantemos o @lid
    if (jid.includes('@lid')) {
      return jid;
    }
    
    // 🌟 CORREÇÃO AQUI: Isolar o número da porta/dispositivo secundário antes de limpar as letras.
    // Exemplo: 559499999999:2@s.whatsapp.net vira apenas 559499999999
    const cleanJid = jid.split('@')[0].split(':')[0];
    return cleanJid.replace(/\D/g, '');
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
        return;
      }

      const school = await this._resolveSchoolByInstance(resolvedInstanceName, hookRunId);

      if (!school) {
        console.warn(
          `⚠️ [${hookRunId}] Nenhuma escola encontrada para a instância: ${resolvedInstanceName}`
        );
        return;
      }

      const evtNormalizado = String(event || '').toLowerCase();

      // --- ATUALIZAÇÃO DE CONEXÃO ---
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

      // --- ATUALIZAÇÃO DE QR CODE ---
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

      // --- CHATS UPDATE (DESPERTADOR BOT) ---
      if (evtNormalizado === 'chats.update') {
        const updates = Array.isArray(data) ? data : [data];
        
        for (const update of updates) {
          if (update && update.unreadCount > 0) {
            const remoteJid = update.id || update.jid;
            if (!remoteJid) continue;

            const phone = this._extractPhone(remoteJid);
            
            console.log(
              `🛎️ [${hookRunId}] Chat marcado como NÃO LIDO | phone=${phone}. Reiniciando bot...`
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

      // --- PROCESSAMENTO DE MENSAGENS RECEBIDAS ---
      if (evtNormalizado !== 'messages.upsert') {
        return;
      }

      console.log(
        `💬 [${hookRunId}] messages.upsert detectado | schoolId=${school._id} | instance=${resolvedInstanceName}`
      );

      if (!data?.key) {
        console.warn(`⚠️ [${hookRunId}] messages.upsert sem data.key`);
        return;
      }

      if (data?.key?.fromMe === true) {
        console.log(`↩️ [${hookRunId}] Mensagem enviada pela própria instância. Ignorando.`);
        return;
      }

      const remoteJid = this._extractRemoteJid(data, sender);

      // 🌟 PROTEÇÃO: Ignorar grupos e Status/Stories
      if (remoteJid && (remoteJid.includes('@g.us') || remoteJid.includes('status@broadcast'))) {
        console.log(`👥 [${hookRunId}] Mensagem de grupo/status ignorada: ${remoteJid}`);
        return;
      }

      const phone = this._extractPhone(remoteJid);

      if (!phone) {
        console.warn(`⚠️ [${hookRunId}] Webhook WhatsApp sem telefone identificável.`);
        return;
      }

      const messageText = this._extractMessageText(data);

      if (!messageText || !String(messageText).trim()) {
        console.warn(`⚠️ [${hookRunId}] Mensagem sem texto processável | phone=${phone}`);
        return;
      }

      await School.findByIdAndUpdate(school._id, {
        'whatsapp.instanceName': resolvedInstanceName,
        'whatsapp.status': 'connected',
        'whatsapp.lastSyncAt': new Date(),
        'whatsapp.lastError': null,
      });

      console.log(
        `🤖 [${hookRunId}] Encaminhando mensagem para o bot | phone=${phone} | text="${messageText}"`
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

  async handleMpWebhook(req, res) {
    const hookRunId = `mp-${Date.now()}`;
    console.log(`--- 🔔 WEBHOOK MERCADO PAGO RECEBIDO (${hookRunId}) ---`);

    res.status(200).json({ status: 'recebido' });

    const paymentId = req.query['data.id'] || req.body?.data?.id;

    if (!paymentId) {
      console.log(`ℹ️ [${hookRunId}] Evento MP sem paymentId (ignorando). query=`, req.query);
      return;
    }

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
    } catch (error) {
      console.error(`❌ [${hookRunId}] Erro processando Webhook MP:`, error.message);
    }
  }

  async handleCoraWebhook(req, res) {
    const hookRunId = `cora-${Date.now()}`;
    res.status(200).send('OK');
    console.log(`--- 🏦 WEBHOOK CORA RECEBIDO (${hookRunId}) ---`);

    const headers = req.headers || {};
    const eventType = headers['webhook-event-type'] || headers['x-webhook-event-type'] || headers['x-cora-webhook-event-type'] || headers['event-type'] || null;
    const resourceId = headers['webhook-resource-id'] || headers['x-webhook-resource-id'] || headers['x-cora-webhook-resource-id'] || headers['resource-id'] || null;
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
      console.error(`❌ Erro Webhook Cora:`, error.message);
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