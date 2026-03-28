const axios = require('axios');
const School = require('../models/school.model');
const WhatsappTransportLog = require('../models/whatsapp_transport_log.model');

class WhatsappService {
  constructor() {
    this.apiUrl = process.env.EVOLUTION_API_URL;
    this.apiKey = process.env.EVOLUTION_API_KEY;
    this.webhookUrl = process.env.EVOLUTION_WEBHOOK_URL;
  }

  _getInstanceName(schoolId) {
    return `school_${schoolId}`;
  }

  _getHeaders() {
    return {
      apikey: this.apiKey,
    };
  }

  _normalizePhone(phone) {
    let number = String(phone || '').replace(/\D/g, '');

    if (!number.startsWith('55') && (number.length === 10 || number.length === 11)) {
      number = `55${number}`;
    }

    return number;
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
      const date = new Date(normalized);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  _cleanObject(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
    );
  }

  _extractSendResponseDetails(responseData = {}, fallback = {}) {
    const directPayload = responseData?.key ? responseData : null;
    const nestedPayload = responseData?.data?.key ? responseData.data : null;
    const payload = directPayload || nestedPayload || responseData?.data || responseData || {};
    const key = payload?.key || {};

    const providerMessageId =
      key.id ||
      payload?.keyId ||
      payload?.messageId ||
      payload?.id ||
      responseData?.messageId ||
      null;

    const remoteJid = key.remoteJid || payload?.remoteJid || fallback.remoteJid || null;
    const instanceId = payload?.instanceId || responseData?.instanceId || fallback.instanceId || null;
    const providerStatus = String(payload?.status || responseData?.status || '').trim() || null;
    const providerMessageTimestamp = this._toDate(
      payload?.messageTimestamp || responseData?.messageTimestamp || null
    );

    return {
      providerMessageId,
      remoteJid,
      instanceId,
      providerStatus,
      providerMessageTimestamp,
      rawPayload: responseData,
    };
  }

  _buildTransportMetadata(context = {}, details = {}) {
    return this._cleanObject({
      ...(context || {}),
      ...(details || {}),
    });
  }

  _mapEvolutionStateToDbStatus(state, hasQrCode = false) {
    const normalized = String(state || '').toLowerCase();

    if (normalized === 'open') return 'connected';
    if (normalized === 'connecting') return 'connecting';
    if (normalized === 'close' || normalized === 'closed') return 'disconnected';
    if (normalized === 'disconnected') return 'disconnected';
    if (normalized === 'qrcode' || normalized === 'qr' || hasQrCode) return 'qr_pending';

    return 'disconnected';
  }

  async _updateSchoolWhatsappState(schoolId, patch = {}) {
    const now = new Date();

    const payload = {
      'whatsapp.instanceName': patch.instanceName ?? this._getInstanceName(schoolId),
      'whatsapp.lastSyncAt': patch.lastSyncAt ?? now,
    };

    if (patch.status !== undefined) payload['whatsapp.status'] = patch.status;
    if (patch.qrCode !== undefined) payload['whatsapp.qrCode'] = patch.qrCode;
    if (patch.connectedPhone !== undefined) payload['whatsapp.connectedPhone'] = patch.connectedPhone;
    if (patch.profileName !== undefined) payload['whatsapp.profileName'] = patch.profileName;
    if (patch.lastError !== undefined) payload['whatsapp.lastError'] = patch.lastError;
    if (patch.lastConnectedAt !== undefined) payload['whatsapp.lastConnectedAt'] = patch.lastConnectedAt;
    if (patch.lastDisconnectedAt !== undefined) payload['whatsapp.lastDisconnectedAt'] = patch.lastDisconnectedAt;

    await School.findByIdAndUpdate(schoolId, payload);
  }

  async setInstanceWebhook(instanceName) {
    if (!this.webhookUrl) {
      throw new Error('EVOLUTION_WEBHOOK_URL nao configurada no ambiente.');
    }

    const url = `${this.apiUrl}/webhook/set/${instanceName}`;

    const payload = {
      webhook: {
        enabled: true,
        url: this.webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        byEvents: false,
        base64: false,
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'MESSAGES_DELETE',
          'SEND_MESSAGE',
          'QRCODE_UPDATED',
          'CONNECTION_UPDATE',
        ],
      },
    };

    try {
      console.log(
        `[Zap] Configuring webhook | instance=${instanceName} | apiUrl=${this.apiUrl} | webhookUrl=${this.webhookUrl}`
      );

      const response = await axios.post(url, payload, {
        headers: this._getHeaders(),
      });

      console.log(`[Zap] Webhook configured successfully for ${instanceName}`);
      return response.data;
    } catch (error) {
      const errorData = error.response?.data || null;

      console.error(`[Zap] Failed to configure webhook for instance ${instanceName}`);
      console.error('status:', error.response?.status);
      console.error('data:', JSON.stringify(errorData, null, 2));

      throw new Error(
        `Falha ao configurar webhook da instancia ${instanceName}: ${
          error.response?.data?.message ? JSON.stringify(error.response.data.message) : error.message
        }`
      );
    }
  }

  async connectSchool(schoolId) {
    const instanceName = this._getInstanceName(schoolId);
    const connectUrl = `${this.apiUrl}/instance/connect/${instanceName}`;

    console.log(`[Zap] Starting connection process for ${instanceName}`);
    console.log(`[Zap] Current config | apiUrl=${this.apiUrl} | webhookUrl=${this.webhookUrl}`);

    await this._updateSchoolWhatsappState(schoolId, {
      instanceName,
      status: 'connecting',
      lastError: null,
    });

    try {
      let currentStatus = 'disconnected';

      try {
        const statusData = await this.getConnectionStatus(instanceName);
        currentStatus = statusData.status;
      } catch (err) {
        console.warn(`[Zap] Failed to check previous status: ${err.message}`);
      }

      if (currentStatus === 'open') {
        console.log(`[Zap] Instance ${instanceName} was already connected.`);

        await this.setInstanceWebhook(instanceName);

        await this._updateSchoolWhatsappState(schoolId, {
          instanceName,
          status: 'connected',
          qrCode: null,
          lastConnectedAt: new Date(),
          lastError: null,
        });

        return {
          status: 'open',
          instanceName,
          qrCode: null,
        };
      }

      if (currentStatus !== 'disconnected') {
        console.log(`[Zap] Cleaning dirty state (${currentStatus})...`);

        try {
          await this.logoutSchool(schoolId, { preserveInstanceName: true });
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } catch (cleanupError) {
          console.warn(`[Zap] Failed to clean previous state: ${cleanupError.message}`);
        }
      }

      console.log(`[Zap] Requesting new connection...`);

      const response = await axios.get(connectUrl, {
        headers: this._getHeaders(),
      });

      await this.setInstanceWebhook(instanceName);

      const qrCode =
        response.data?.base64 ||
        response.data?.qrcode?.base64 ||
        response.data?.qrcode ||
        null;

      const nextStatus = qrCode ? 'qr_pending' : 'connecting';

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: nextStatus,
        qrCode,
        lastError: null,
      });

      return {
        status: nextStatus === 'qr_pending' ? 'qrcode' : 'connecting',
        qrCode,
        instanceName,
      };
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.message ||
        'Falha ao conectar ao WhatsApp.';

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: 'error',
        lastError: message,
      });

      if (error.response?.status === 403) {
        throw new Error('Sessao em limpeza. Aguarde alguns segundos e tente novamente.');
      }

      throw new Error(`Falha ao conectar: ${message}`);
    }
  }

  async getConnectionStatus(instanceName) {
    const url = `${this.apiUrl}/instance/connectionState/${instanceName}`;

    try {
      const response = await axios.get(url, {
        headers: this._getHeaders(),
      });

      const state = response.data?.instance?.state || response.data?.state || 'disconnected';

      console.log(`[Zap] Status consulted | instance=${instanceName} | state=${state}`);

      return {
        status: state,
        instanceName,
        raw: response.data,
      };
    } catch (error) {
      console.warn(
        `[Zap] Failed to consult status | instance=${instanceName} | httpStatus=${
          error.response?.status || 'N/A'
        } | message=${error.message}`
      );

      if (error.response?.status === 404) {
        return {
          status: 'disconnected',
          instanceName,
          raw: null,
        };
      }

      return {
        status: 'disconnected',
        instanceName,
        raw: error.response?.data || null,
      };
    }
  }

  async logoutSchool(schoolId, options = {}) {
    const instanceName = this._getInstanceName(schoolId);
    const url = `${this.apiUrl}/instance/logout/${instanceName}`;
    const preserveInstanceName = options.preserveInstanceName !== false;

    try {
      await axios.delete(url, {
        headers: this._getHeaders(),
      });

      console.log(`[Zap] Logout completed for ${instanceName}`);
    } catch (error) {
      const status = error.response?.status;

      if (status === 404) {
        console.log(`[Zap] Instance ${instanceName} not found during logout. Treating as disconnected.`);
      } else if (status === 400) {
        console.warn(`[Zap] Logout returned 400 for ${instanceName}. Treating as already clean/invalid.`);
      } else {
        console.warn(`[Zap] Logout warning from API: ${error.message}`);
      }
    } finally {
      await this._updateSchoolWhatsappState(schoolId, {
        instanceName: preserveInstanceName ? instanceName : null,
        status: 'disconnected',
        qrCode: null,
        lastDisconnectedAt: new Date(),
        lastError: null,
      });
    }
  }

  async sendText(schoolId, phone, message, context = {}) {
    const instanceName = this._getInstanceName(schoolId);
    const url = `${this.apiUrl}/message/sendText/${instanceName}`;

    const number = this._normalizePhone(phone);
    const queuedAt = new Date();
    const source = context?.source || 'whatsapp.service';
    const transportMetadata = this._buildTransportMetadata(context, {
      transport_kind: 'text',
      target_phone: number,
      request_preview: String(message || '').trim().slice(0, 1000),
    });

    if (number.length < 12) {
      console.error(`[Zap] Invalid number detected: ${phone}`);
      throw new Error(`Numero de telefone invalido (verifique o DDD): ${phone}`);
    }

    const payload = {
      number,
      options: {
        delay: 1200,
        presence: 'composing',
      },
      text: message,
    };

    try {
      console.log(
        `[Zap] Sending text | instance=${instanceName} | number=${number} | text="${String(message || '').slice(0, 120)}"`
      );

      const response = await axios.post(url, payload, {
        headers: this._getHeaders(),
      });

      const responseData = response.data || {};
      const sendDetails = this._extractSendResponseDetails(responseData, {
        remoteJid: `${number}@s.whatsapp.net`,
      });

      try {
        await WhatsappTransportLog.recordSendAcceptance({
          schoolId,
          instanceName,
          instanceId: sendDetails.instanceId,
          providerMessageId: sendDetails.providerMessageId,
          remoteJid: sendDetails.remoteJid,
          destination: number,
          providerStatus: sendDetails.providerStatus,
          providerMessageTimestamp: sendDetails.providerMessageTimestamp,
          queuedAt,
          acceptedAt: new Date(),
          rawSendResponse: sendDetails.rawPayload,
          source,
          metadata: transportMetadata,
        });
      } catch (transportError) {
        console.error(
          `[Zap] Failed to persist text transport log | instance=${instanceName} | error=${transportError.message}`
        );
      }

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: 'connected',
        qrCode: null,
        lastConnectedAt: new Date(),
        lastError: null,
      });

      console.log(`[Zap] Text accepted by Evolution | instance=${instanceName}`);
      return responseData;
    } catch (error) {
      const errorData = error.response ? JSON.stringify(error.response.data) : error.message;
      const messageText =
        error.response?.data?.message ||
        error.message ||
        'Falha no envio de mensagem.';

      console.error(`[Zap] Evolution text send error: ${errorData}`);

      try {
        await WhatsappTransportLog.recordSendFailure({
          schoolId,
          instanceName,
          destination: number,
          remoteJid: `${number}@s.whatsapp.net`,
          providerStatus: error.response?.data?.status || null,
          queuedAt,
          failedAt: new Date(),
          errorMessage: messageText,
          errorCode: error.code || error.response?.data?.code || null,
          errorHttpStatus: error.response?.status || null,
          rawError: error.response?.data || {
            message: error.message,
            stack: error.stack,
          },
          source,
          metadata: transportMetadata,
        });
      } catch (transportError) {
        console.error(
          `[Zap] Failed to persist text error log | instance=${instanceName} | error=${transportError.message}`
        );
      }

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: 'error',
        lastError: messageText,
      });

      throw new Error(`Falha no envio WhatsApp: ${messageText}`);
    }
  }

  async sendFile(schoolId, phone, fileUrl, fileName, caption, context = {}) {
    const instanceName = this._getInstanceName(schoolId);
    const url = `${this.apiUrl}/message/sendMedia/${instanceName}`;

    const number = this._normalizePhone(phone);
    const queuedAt = new Date();
    const source = context?.source || 'whatsapp.service';
    const transportMetadata = this._buildTransportMetadata(context, {
      transport_kind: 'document',
      target_phone: number,
      file_name: fileName || null,
      file_url: fileUrl || null,
      caption_preview: String(caption || '').trim().slice(0, 500) || null,
    });

    if (number.length < 12) {
      throw new Error(`Numero de telefone invalido (PDF): ${phone}`);
    }

    const payload = {
      number,
      options: {
        delay: 1200,
        presence: 'composing',
      },
      mediatype: 'document',
      caption,
      media: fileUrl,
      fileName,
    };

    try {
      console.log(`[Zap] Sending file | instance=${instanceName} | number=${number}`);

      const response = await axios.post(url, payload, {
        headers: this._getHeaders(),
      });

      const responseData = response.data || {};
      const sendDetails = this._extractSendResponseDetails(responseData, {
        remoteJid: `${number}@s.whatsapp.net`,
      });

      try {
        await WhatsappTransportLog.recordSendAcceptance({
          schoolId,
          instanceName,
          instanceId: sendDetails.instanceId,
          providerMessageId: sendDetails.providerMessageId,
          remoteJid: sendDetails.remoteJid,
          destination: number,
          providerStatus: sendDetails.providerStatus,
          providerMessageTimestamp: sendDetails.providerMessageTimestamp,
          queuedAt,
          acceptedAt: new Date(),
          rawSendResponse: sendDetails.rawPayload,
          source,
          metadata: transportMetadata,
        });
      } catch (transportError) {
        console.error(
          `[Zap] Failed to persist file transport log | instance=${instanceName} | error=${transportError.message}`
        );
      }

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: 'connected',
        qrCode: null,
        lastConnectedAt: new Date(),
        lastError: null,
      });

      console.log(`[Zap] Document accepted by Evolution | instance=${instanceName}`);
      return responseData;
    } catch (error) {
      const errorData = error.response ? JSON.stringify(error.response.data) : error.message;
      const messageText =
        error.response?.data?.message ||
        error.message ||
        'Falha no envio do arquivo.';

      console.error(`[Zap] Evolution file send error: ${errorData}`);

      try {
        await WhatsappTransportLog.recordSendFailure({
          schoolId,
          instanceName,
          destination: number,
          remoteJid: `${number}@s.whatsapp.net`,
          providerStatus: error.response?.data?.status || null,
          queuedAt,
          failedAt: new Date(),
          errorMessage: messageText,
          errorCode: error.code || error.response?.data?.code || null,
          errorHttpStatus: error.response?.status || null,
          rawError: error.response?.data || {
            message: error.message,
            stack: error.stack,
          },
          source,
          metadata: transportMetadata,
        });
      } catch (transportError) {
        console.error(
          `[Zap] Failed to persist file error log | instance=${instanceName} | error=${transportError.message}`
        );
      }

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: 'error',
        lastError: messageText,
      });

      throw new Error(`Falha no envio do PDF: ${messageText}`);
    }
  }

  async ensureConnection(schoolId) {
    try {
      const instanceName = this._getInstanceName(schoolId);
      const statusData = await this.getConnectionStatus(instanceName);

      const rawStatus = statusData.status;
      const dbStatus = this._mapEvolutionStateToDbStatus(rawStatus);

      if (rawStatus === 'open') {
        console.log(`[Auto-Heal] Instance ${instanceName} online. Updating database...`);

        await this.setInstanceWebhook(instanceName);

        await this._updateSchoolWhatsappState(schoolId, {
          instanceName,
          status: 'connected',
          qrCode: null,
          lastConnectedAt: new Date(),
          lastError: null,
        });

        return true;
      }

      console.warn(`[Auto-Heal] Instance ${instanceName} is not open. Real state: ${rawStatus}`);

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: dbStatus,
        ...(dbStatus === 'disconnected' ? { lastDisconnectedAt: new Date() } : {}),
      });

      return false;
    } catch (error) {
      const instanceName = this._getInstanceName(schoolId);

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: 'error',
        lastError: error.message || 'Erro ao validar conexao do WhatsApp.',
      });

      return false;
    }
  }
}

module.exports = new WhatsappService();
