const whatsappService = require('../whatsapp.service');
const notificationTransportLogService = require('../notificationTransportLog.service');

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const normalized = value < 1e12 ? value * 1000 : value;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractSendResponseDetails(responseData = {}, fallback = {}) {
  const directPayload = responseData?.key ? responseData : null;
  const nestedPayload = responseData?.data?.key ? responseData.data : null;
  const payload = directPayload || nestedPayload || responseData?.data || responseData || {};
  const key = payload?.key || {};

  return {
    providerMessageId:
      key.id ||
      payload?.keyId ||
      payload?.messageId ||
      payload?.id ||
      responseData?.messageId ||
      null,
    remoteJid: key.remoteJid || payload?.remoteJid || fallback.remoteJid || null,
    instanceId: payload?.instanceId || responseData?.instanceId || fallback.instanceId || null,
    providerStatus: normalizeString(payload?.status || responseData?.status) || null,
    providerMessageTimestamp: toDate(payload?.messageTimestamp || responseData?.messageTimestamp || null),
  };
}

class WhatsappTransport {
  constructor({
    whatsappService: legacyWhatsappService = whatsappService,
    notificationTransportLogService: transportLogService = notificationTransportLogService,
  } = {}) {
    this.whatsappService = legacyWhatsappService;
    this.notificationTransportLogService = transportLogService;
  }

  async send({ notificationLog, invoice, message }) {
    const phone = notificationLog?.target_phone_normalized || notificationLog?.target_phone;

    if (!phone) {
      const error = new Error('Tutor/aluno sem telefone valido para envio WhatsApp.');
      error.code = 'MISSING_WHATSAPP_TARGET';
      throw error;
    }

    const shouldTryFile = message?.transportHints?.whatsapp?.shouldTryFile === true;
    const attachment = Array.isArray(message?.attachmentsPlan) ? message.attachmentsPlan[0] : null;
    const requestKind = shouldTryFile && attachment ? 'document' : 'text';

    const attempt = await this.notificationTransportLogService.createAttempt({
      schoolId: notificationLog.school_id,
      notificationLogId: notificationLog._id,
      invoiceId: invoice?._id || notificationLog.invoice_id || null,
      channel: 'whatsapp',
      provider: 'evolution',
      destination: phone,
      destinationPhone: phone,
      requestKind,
      source: 'whatsapp.transport',
      subject: null,
      bodyPreview: message?.message_preview || message?.text || null,
      attachments: requestKind === 'document' && attachment ? [attachment] : [],
      metadata: {
        notification_type: notificationLog.type,
        delivery_key: notificationLog.delivery_key || null,
        dispatch_origin: notificationLog.dispatch_origin || null,
      },
      rawRequestPayload: {
        text: message?.text || null,
        attachment,
      },
    });

    try {
      const schoolId = notificationLog.school_id;
      const isConnected = await this.whatsappService.ensureConnection(schoolId);
      if (!isConnected) {
        const disconnectedError = new Error('WhatsApp desconectado (confirmado pela API).');
        disconnectedError.code = 'WHATSAPP_DISCONNECTED';
        throw disconnectedError;
      }

      const context = {
        source: 'notification.service',
        notification_log_id: notificationLog._id,
        invoice_id: invoice?._id || null,
        school_id: schoolId,
        notification_type: notificationLog.type,
        delivery_key: notificationLog.delivery_key || null,
        business_day: notificationLog.business_day || null,
        business_timezone: notificationLog.business_timezone || null,
        dispatch_origin: notificationLog.dispatch_origin || null,
        template_group: message?.template_group || null,
        template_index: message?.template_index ?? null,
        request_kind: requestKind,
        transport_attempt_id: attempt._id,
        fallback_from: requestKind === 'document' ? null : null,
      };

      let responseData;
      if (requestKind === 'document' && attachment?.sourceUrl) {
        responseData = await this.whatsappService.sendFile(
          schoolId,
          phone,
          attachment.sourceUrl,
          attachment.filename,
          message.text,
          context
        );
      } else {
        responseData = await this.whatsappService.sendText(
          schoolId,
          phone,
          message.text,
          context
        );
      }

      const details = extractSendResponseDetails(responseData, {
        remoteJid: `${phone}@s.whatsapp.net`,
      });

      const updatedAttempt = await this.notificationTransportLogService.markAccepted(attempt._id, {
        providerStatus: details.providerStatus || 'PENDING',
        providerMessageId: details.providerMessageId,
        destination: phone,
        destinationPhone: phone,
        instanceName: `school_${notificationLog.school_id}`,
        instanceId: details.instanceId,
        remoteJid: details.remoteJid,
        eventAt: details.providerMessageTimestamp || new Date(),
        rawProviderResponse: responseData,
        source: 'whatsapp.transport',
        metadata: {
          request_kind: requestKind,
        },
      });

      return {
        attempt: updatedAttempt,
        response: responseData,
      };
    } catch (error) {
      const failedAttempt = await this.notificationTransportLogService.markFailed(attempt._id, {
        errorMessage: error.message || 'Falha ao enviar mensagem pelo WhatsApp.',
        errorCode: error.code || 'WHATSAPP_SEND_FAILED',
        errorHttpStatus: error.response?.status || null,
        rawLastError: error.response?.data || {
          message: error.message,
          stack: error.stack,
        },
        source: 'whatsapp.transport',
      });

      error.transportAttempt = failedAttempt;
      throw error;
    }
  }
}

module.exports = WhatsappTransport;
