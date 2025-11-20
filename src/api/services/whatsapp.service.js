const axios = require('axios');
const School = require('../models/school.model');

const EVO_URL = process.env.EVOLUTION_API_URL; 
const EVO_GLOBAL_KEY = process.env.EVOLUTION_API_KEY;

class WhatsappService {
    
    constructor() {
        if (!EVO_URL || !EVO_GLOBAL_KEY) {
            console.error('❌ [FATAL] Configurações da Evolution API ausentes no .env!');
        }

        this.api = axios.create({
            baseURL: EVO_URL,
            headers: {
                'apikey': EVO_GLOBAL_KEY,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Cria ou recupera uma instância para a escola.
     */
    async connectSchool(schoolId) {
        const instanceName = `school_${schoolId}`;
        
        console.log(`🔌 [Zap] Tentando conectar instância: ${instanceName}`);

        try {
            const response = await this.api.post('/instance/create', {
                instanceName: instanceName,
                qrcode: true,
                integration: "WHATSAPP-BAILEYS"
            });

            console.log('✅ [Zap] Instância criada com sucesso!');
            
            return {
                instanceName,
                qrcode: response.data.qrcode,
                status: response.data.instance.status
            };
        } catch (error) {
            // --- CORREÇÃO AQUI ---
            // Analisa o corpo do erro para ver se é "Instance already in use"
            const errorData = error.response?.data;
            // A mensagem pode vir em lugares diferentes dependendo da versão, checamos todos
            const msgArray = errorData?.response?.message || []; 
            const msgString = JSON.stringify(errorData || {});

            const isAlreadyInUse = 
                msgString.includes('already in use') || 
                msgString.includes('already exists') ||
                (Array.isArray(msgArray) && msgArray.some(m => m.includes('already in use')));

            if (isAlreadyInUse) {
                console.log('⚠️ [Zap] Instância já existe (Erro 403 falso). Recuperando status...');
                return this.getConnectionStatus(instanceName);
            }
            
            // Só lança erro de chave se NÃO for caso de instância duplicada
            if (error.response?.status === 403) {
                this.logAxiosError(error);
                throw new Error(`ERRO DE CHAVE (403): Verifique se a EVOLUTION_API_KEY no .env está igual à AUTHENTICATION_API_KEY da Evolution.`);
            }

            this.logAxiosError(error);
            throw new Error(`Falha ao criar instância WhatsApp: ${error.message}`);
        }
    }

    /**
     * Verifica status da conexão e recupera o QR Code se desconectado
     */
    async getConnectionStatus(instanceName) {
        try {
            // 1. Tenta pegar o status da conexão
            const response = await this.api.get(`/instance/connectionState/${instanceName}`);
            const state = response.data.instance?.state || 'close';

            // 2. Se estiver desconectado ('close'), precisamos forçar a conexão para gerar novo QR Code
            let qrcode = null;
            if (state === 'close' || state === 'connecting') {
                try {
                    const connectRes = await this.api.get(`/instance/connect/${instanceName}`);
                    qrcode = connectRes.data.base64 || connectRes.data.qrcode;
                } catch (err) {
                    console.warn(`[Zap] Falha ao buscar QR Code na reconexão: ${err.message}`);
                }
            }

            return {
                instanceName,
                status: state,
                qrcode: qrcode // Retorna o QR Code se precisar reconectar
            };

        } catch (error) {
            console.error(`[Zap] Instância ${instanceName} não encontrada no status.`);
            return { instanceName, status: 'not_found' };
        }
    }

    async logoutSchool(schoolId) {
        const instanceName = `school_${schoolId}`;
        try {
            await this.api.delete(`/instance/logout/${instanceName}`);
            await School.findByIdAndUpdate(schoolId, { 'whatsapp.status': 'disconnected' });
            return true;
        } catch (error) {
            console.error('Erro ao deslogar:', error.message);
            return false;
        }
    }

    async sendText(schoolId, number, text) {
        const instanceName = `school_${schoolId}`;
        const cleanNumber = number.replace(/\D/g, ''); 
        const formattedNumber = cleanNumber.length <= 11 ? `55${cleanNumber}` : cleanNumber;

        try {
            await this.api.post(`/message/sendText/${instanceName}`, {
                number: formattedNumber,
                text: text
            });
        } catch (error) {
            console.error(`❌ [WhatsApp] Falha ao enviar msg: ${error.message}`);
        }
    }

    logAxiosError(error) {
        if (error.response) {
            console.error('❌ DATA:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('❌ Erro:', error.message);
        }
    }
}

module.exports = new WhatsappService();