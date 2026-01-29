// src/api/services/whatsapp.service.js
const axios = require('axios');
const School = require('../models/school.model');

class WhatsappService {
    constructor() {
        this.apiUrl = process.env.EVOLUTION_API_URL;
        this.apiKey = process.env.EVOLUTION_API_KEY;
    }

    async connectSchool(schoolId) {
        const instanceName = `school_${schoolId}`;
        const connectUrl = `${this.apiUrl}/instance/connect/${instanceName}`;
        
        console.log(`🔌 [Zap] Iniciando processo de conexão para: ${instanceName}`);

        try {
            let currentStatus = 'disconnected';
            try {
                const statusData = await this.getConnectionStatus(instanceName);
                currentStatus = statusData.status;
            } catch (err) {
                if (err.response?.status !== 404) console.warn("Erro ao checar status prévio:", err.message);
            }

            if (currentStatus === 'open') {
                console.log(`✅ [Zap] Instância já estava conectada.`);
                return { status: 'open', instanceName };
            }

            if (currentStatus !== 'disconnected') {
                console.log(`🧹 [Zap] Limpando estado sujo (${currentStatus})...`);
                try {
                    await this.logoutSchool(schoolId);
                    await new Promise(r => setTimeout(r, 3000));
                } catch (e) { /* ignore */ }
            }

            console.log(`🚀 [Zap] Solicitando nova conexão...`);
            const response = await axios.get(connectUrl, {
                headers: { 'apikey': this.apiKey }
            });

            return {
                status: 'connecting',
                qrCode: response.data.base64 || response.data.qrcode?.base64 || response.data.qrcode, 
                instanceName: instanceName
            };

        } catch (error) {
            if (error.response && error.response.status === 403) {
                throw new Error("Sessão em limpeza. Aguarde 10 segundos e tente novamente.");
            }
            throw new Error(`Falha ao conectar: ${error.message}`);
        }
    }

    async getConnectionStatus(instanceName) {
        const url = `${this.apiUrl}/instance/connectionState/${instanceName}`;
        try {
            const response = await axios.get(url, { headers: { 'apikey': this.apiKey } });
            const state = response.data?.instance?.state || response.data?.state;
            return { status: state, instanceName };
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { status: 'disconnected', instanceName };
            }
            return { status: 'disconnected', instanceName };
        }
    }

    async logoutSchool(schoolId) {
        const instanceName = `school_${schoolId}`;
        const url = `${this.apiUrl}/instance/logout/${instanceName}`;
        try {
            await axios.delete(url, { headers: { 'apikey': this.apiKey } });
        } catch (error) {
            if (error.response && error.response.status === 404) return;
            console.warn(`Aviso no logout API: ${error.message}`);
        } finally {
            await School.findByIdAndUpdate(schoolId, { 
                'whatsapp.status': 'disconnected',
                'whatsapp.qrCode': null,
                'whatsapp.instanceName': null
            });
        }
    }

    async sendText(schoolId, phone, message) {
        const instanceName = `school_${schoolId}`;
        const url = `${this.apiUrl}/message/sendText/${instanceName}`;
        
        let number = (phone || '').replace(/\D/g, '');
        if (!number.startsWith('55') && (number.length === 10 || number.length === 11)) {
            number = '55' + number;
        }

        if (number.length < 12) {
            console.error(`❌ [Zap] Número inválido detectado: ${phone}`);
            throw new Error(`Número de telefone inválido (verifique o DDD): ${phone}`);
        }

        // Payload corrigido (Text Message na raiz)
        const payload = {
            number: number,
            options: { delay: 1200, presence: 'composing' },
            text: message 
        };

        try {
            console.log(`📤 [Zap] Enviando para ${instanceName} | Num: ${number}`);
            await axios.post(url, payload, {
                headers: { 'apikey': this.apiKey }
            });
            console.log(`✅ [Zap] Mensagem enviada com sucesso!`);
        } catch (error) {
            const errorData = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error(`❌ [Zap] Erro Evolution Texto: ${errorData}`);
            throw new Error(`Falha no envio WhatsApp: ${error.response?.data?.message || error.message}`);
        }
    }

    // --- CORREÇÃO AQUI NO SENDFILE ---
    async sendFile(schoolId, phone, fileUrl, fileName, caption) {
        const instanceName = `school_${schoolId}`;
        const url = `${this.apiUrl}/message/sendMedia/${instanceName}`;
        
        let number = (phone || '').replace(/\D/g, '');
        if (!number.startsWith('55') && (number.length === 10 || number.length === 11)) {
            number = '55' + number;
        }

        if (number.length < 12) {
             throw new Error(`Número de telefone inválido (PDF): ${phone}`);
        }

        // [CORREÇÃO] Payload simplificado (sem 'mediaMessage')
        const payload = {
            number: number,
            options: { delay: 1200, presence: 'composing' },
            mediatype: 'document', // ou 'image', 'video'
            caption: caption,
            media: fileUrl,
            fileName: fileName
        };

        try {
            console.log(`📤 [Zap] Enviando PDF para ${number}`);
            await axios.post(url, payload, {
                headers: { 'apikey': this.apiKey }
            });
            console.log(`✅ [Zap] PDF enviado com sucesso!`);
        } catch (error) {
            const errorData = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error(`❌ [Zap] Erro Envio PDF: ${errorData}`);
            throw new Error(`Falha no envio do PDF: ${error.response?.data?.message || error.message}`);
        }
    }

    async ensureConnection(schoolId) {
        try {
            const instanceName = `school_${schoolId}`;
            const statusData = await this.getConnectionStatus(instanceName);

            if (statusData.status === 'open') {
                console.log(`✅ [Auto-Heal] Instância ${instanceName} ONLINE! Atualizando banco...`);
                await School.findByIdAndUpdate(schoolId, { 
                    'whatsapp.status': 'connected',
                    'whatsapp.qrCode': null 
                });
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }
}

module.exports = new WhatsappService();