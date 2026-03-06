const axios = require('axios');
const School = require('../models/school.model');

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
      throw new Error('EVOLUTION_WEBHOOK_URL não configurada no ambiente.');
    }

    const url = `${this.apiUrl}/webhook/set/${instanceName}`;

    const payload = {
      enabled: true,
      url: this.webhookUrl,
      webhookByEvents: false,
      webhookBase64: false,
      events: [
        'MESSAGES_UPSERT',
        'QRCODE_UPDATED',
        'CONNECTION_UPDATE',
      ],
    };

    try {
      const response = await axios.post(url, payload, {
        headers: this._getHeaders(),
      });

      console.log(`🔗 [Zap] Webhook configurado com sucesso para ${instanceName}`);
      return response.data;
    } catch (error) {
      const errorData = error.response?.data || error.message;
      console.error(`❌ [Zap] Falha ao configurar webhook da instância ${instanceName}:`, errorData);

      throw new Error(
        `Falha ao configurar webhook da instância ${instanceName}: ${
          error.response?.data?.message || error.message
        }`
      );
    }
  }

  async connectSchool(schoolId) {
    const instanceName = this._getInstanceName(schoolId);
    const connectUrl = `${this.apiUrl}/instance/connect/${instanceName}`;

    console.log(`🔌 [Zap] Iniciando processo de conexão para: ${instanceName}`);

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
        console.warn(`⚠️ [Zap] Erro ao checar status prévio: ${err.message}`);
      }

      if (currentStatus === 'open') {
        console.log(`✅ [Zap] Instância ${instanceName} já estava conectada.`);

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
        console.log(`🧹 [Zap] Limpando estado sujo (${currentStatus})...`);

        try {
          await this.logoutSchool(schoolId, { preserveInstanceName: true });
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } catch (cleanupError) {
          console.warn(`⚠️ [Zap] Falha ao limpar estado anterior: ${cleanupError.message}`);
        }
      }

      console.log(`🚀 [Zap] Solicitando nova conexão...`);

      const response = await axios.get(connectUrl, {
        headers: this._getHeaders(),
      });

      // garante o webhook por instância
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
        throw new Error('Sessão em limpeza. Aguarde alguns segundos e tente novamente.');
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

      const state =
        response.data?.instance?.state ||
        response.data?.state ||
        'disconnected';

      return {
        status: state,
        instanceName,
        raw: response.data,
      };
    } catch (error) {
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

      console.log(`🔌 [Zap] Logout realizado para ${instanceName}`);
    } catch (error) {
      const status = error.response?.status;

      if (status === 404) {
        console.log(`ℹ️ [Zap] Instância ${instanceName} não encontrada no logout. Considerando desconectada.`);
      } else if (status === 400) {
        console.warn(`⚠️ [Zap] Logout retornou 400 para ${instanceName}. Tratando como estado já limpo/inválido.`);
      } else {
        console.warn(`⚠️ [Zap] Aviso no logout API: ${error.message}`);
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

  async sendText(schoolId, phone, message) {
    const instanceName = this._getInstanceName(schoolId);
    const url = `${this.apiUrl}/message/sendText/${instanceName}`;

    const number = this._normalizePhone(phone);

    if (number.length < 12) {
      console.error(`❌ [Zap] Número inválido detectado: ${phone}`);
      throw new Error(`Número de telefone inválido (verifique o DDD): ${phone}`);
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
      console.log(`📤 [Zap] Enviando texto | Instância: ${instanceName} | Número: ${number}`);

      await axios.post(url, payload, {
        headers: this._getHeaders(),
      });

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: 'connected',
        qrCode: null,
        lastConnectedAt: new Date(),
        lastError: null,
      });

      console.log(`✅ [Zap] Mensagem enviada com sucesso!`);
    } catch (error) {
      const errorData = error.response ? JSON.stringify(error.response.data) : error.message;
      const messageText =
        error.response?.data?.message ||
        error.message ||
        'Falha no envio de mensagem.';

      console.error(`❌ [Zap] Erro Evolution Texto: ${errorData}`);

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: 'error',
        lastError: messageText,
      });

      throw new Error(`Falha no envio WhatsApp: ${messageText}`);
    }
  }

  async sendFile(schoolId, phone, fileUrl, fileName, caption) {
    const instanceName = this._getInstanceName(schoolId);
    const url = `${this.apiUrl}/message/sendMedia/${instanceName}`;

    const number = this._normalizePhone(phone);

    if (number.length < 12) {
      throw new Error(`Número de telefone inválido (PDF): ${phone}`);
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
      console.log(`📤 [Zap] Enviando arquivo | Instância: ${instanceName} | Número: ${number}`);

      await axios.post(url, payload, {
        headers: this._getHeaders(),
      });

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: 'connected',
        qrCode: null,
        lastConnectedAt: new Date(),
        lastError: null,
      });

      console.log(`✅ [Zap] PDF enviado com sucesso!`);
    } catch (error) {
      const errorData = error.response ? JSON.stringify(error.response.data) : error.message;
      const messageText =
        error.response?.data?.message ||
        error.message ||
        'Falha no envio do arquivo.';

      console.error(`❌ [Zap] Erro Envio PDF: ${errorData}`);

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
        console.log(`✅ [Auto-Heal] Instância ${instanceName} ONLINE! Atualizando banco...`);

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

      console.warn(`⚠️ [Auto-Heal] Instância ${instanceName} não está aberta. Estado real: ${rawStatus}`);

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: dbStatus,
        ...(dbStatus === 'disconnected'
          ? { lastDisconnectedAt: new Date() }
          : {}),
      });

      return false;
    } catch (error) {
      const instanceName = this._getInstanceName(schoolId);

      await this._updateSchoolWhatsappState(schoolId, {
        instanceName,
        status: 'error',
        lastError: error.message || 'Erro ao validar conexão do WhatsApp.',
      });

      return false;
    }
  }
}

module.exports = new WhatsappService();