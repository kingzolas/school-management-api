const axios = require('axios');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

class CoraGateway {
    constructor(config) {
        // 'config' é o objeto coraConfig completo vindo do banco
        this.fullConfig = config; 
        
        // 1. Decide ambiente
        const isSandbox = this.fullConfig.isSandbox === true;
        
        // 2. Seleciona as credenciais corretas
        const credentials = isSandbox ? this.fullConfig.sandbox : this.fullConfig.production;

        // 3. Validação
        if (!credentials || !credentials.clientId || !credentials.certificateContent || !credentials.privateKeyContent) {
            console.error(`❌ [CoraGateway] Credenciais incompletas para o ambiente ${isSandbox ? 'SANDBOX' : 'PRODUÇÃO'}.`);
            this.httpsAgent = null;
            return; // Impede continuação
        }

        // 4. Define URLs
        if (isSandbox) {
            console.log('🧪 [CoraGateway] Inicializando em modo SANDBOX.');
            this.authUrl = 'https://matls-clients.api.stage.cora.com.br/token';
            this.baseUrl = 'https://matls-clients.api.stage.cora.com.br';
        } else {
            console.log('🚀 [CoraGateway] Inicializando em modo PRODUÇÃO.');
            this.authUrl = 'https://matls-clients.api.cora.com.br/token';
            this.baseUrl = 'https://matls-clients.api.cora.com.br';
        }
        
        // 5. Formata Chaves
        const cert = this._formatPem(credentials.certificateContent, 'CERTIFICATE');
        const key = this._formatPem(credentials.privateKeyContent, 'RSA PRIVATE KEY');

        if (cert && key) {
            this.httpsAgent = new https.Agent({
                cert: cert,
                key: key,
                rejectUnauthorized: !isSandbox // Relaxa SSL em sandbox se necessário
            });
            this.clientId = credentials.clientId; // Guarda o ID correto
        } else {
            console.error('❌ [CoraGateway] Falha ao formatar PEM.');
        }
    }

    _formatPem(rawString, type) {
        if (!rawString || typeof rawString !== 'string') return null;
        const header = `-----BEGIN ${type}-----`;
        const footer = `-----END ${type}-----`;
        let cleanBody = rawString
            .replace(new RegExp(`-----BEGIN ${type}-----`, 'gi'), '')
            .replace(new RegExp(`-----END ${type}-----`, 'gi'), '')
            .replace(/-----BEGIN [A-Z0-9 ]+-----/gi, '')
            .replace(/-----END [A-Z0-9 ]+-----/gi, '')
            .replace(/[^a-zA-Z0-9+/=]/g, ''); 
        if (cleanBody.length < 10) return null;
        const match = cleanBody.match(/.{1,64}/g);
        const bodyFormatted = match ? match.join('\n') : cleanBody;
        return `${header}\n${bodyFormatted}\n${footer}`;
    }

    async authenticate() {
        if (!this.httpsAgent || !this.clientId) {
            throw new Error('Configuração da Cora inválida para o ambiente selecionado.');
        }

        try {
            const body = {
                grant_type: 'client_credentials',
                client_id: this.clientId
            };

            const response = await axios.post(this.authUrl, body, {
                httpsAgent: this.httpsAgent,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            return response.data.access_token;

        } catch (error) {
            const detail = error.response?.data || error.message;
            console.error('[Cora Gateway] Falha Auth:', detail);
            throw new Error(`Falha Auth Cora: ${JSON.stringify(detail)}`);
        }
    }

    async createInvoice(data) {
        const token = await this.authenticate();
        const { value, description, dueDate, payer, internalId } = data;

        const dataVencimento = new Date(dueDate).toISOString().split('T')[0];
        const nomeCliente = payer.name ? payer.name.substring(0, 60) : 'Cliente'; 
        
        const body = {
            code: internalId ? internalId.toString() : uuidv4(),
            customer: {
                name: nomeCliente,
                email: payer.email,
                document: {
                    identity: payer.cpf.replace(/\D/g, ''),
                    type: 'CPF'
                }
            },
            services: [
                {
                    name: description,
                    amount: value 
                }
            ],
            payment_terms: {
                due_date: dataVencimento
            }
        };

        try {
            const response = await axios.post(`${this.baseUrl}/v2/invoices`, body, {
                httpsAgent: this.httpsAgent,
                headers: { 
                    Authorization: `Bearer ${token}`,
                    'Idempotency-Key': uuidv4()
                }
            });

            const invoiceData = response.data;
            const boleto = invoiceData.payment_options?.bank_slip || {};

            return {
                gateway: 'cora',
                external_id: invoiceData.id,
                status: 'pending',
                pix_code: null, 
                pix_qr_base64: null,
                boleto_url: boleto.url,
                boleto_barcode: boleto.barcode,
                boleto_digitable: boleto.digitable_line,
                raw: invoiceData
            };

        } catch (error) {
            console.error('[Cora Gateway] Erro Create:', error.response?.data || error.message);
            throw new Error(`Erro Cora Create: ${JSON.stringify(error.response?.data || error.message)}`);
        }
    }

    async cancelInvoice(externalId) {
        return null;
    }
}

module.exports = CoraGateway;