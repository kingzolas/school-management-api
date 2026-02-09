// src/api/gateways/cora.gateway.js
const axios = require('axios');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

class CoraGateway {
    constructor(config) {
        this.fullConfig = config; 
        
        // 1. Decide ambiente
        const isSandbox = this.fullConfig.isSandbox === true;
        
        // 2. Seleciona as credenciais corretas
        const credentials = isSandbox ? this.fullConfig.sandbox : this.fullConfig.production;

        // 3. Validação
        if (!credentials || !credentials.clientId || !credentials.certificateContent || !credentials.privateKeyContent) {
            console.error(`❌ [CoraGateway] Credenciais incompletas para o ambiente ${isSandbox ? 'SANDBOX' : 'PRODUÇÃO'}.`);
            this.httpsAgent = null;
            return;
        }

        // 4. Define URLs (CORREÇÃO: Usar matls-clients para TUDO na integração direta)
        if (isSandbox) {
            console.log('🧪 [CoraGateway] Inicializando em modo SANDBOX (mTLS).');
            this.authUrl = 'https://matls-clients.api.stage.cora.com.br/token';
            this.baseUrl = 'https://matls-clients.api.stage.cora.com.br'; 
        } else {
            console.log('🚀 [CoraGateway] Inicializando em modo PRODUÇÃO (mTLS).');
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
            this.clientId = credentials.clientId;
        } else {
            console.error('❌ [CoraGateway] Falha ao formatar PEM. Verifique se as chaves no banco começam com -----BEGIN...');
        }
    }

    _formatPem(rawString, type) {
        if (!rawString || typeof rawString !== 'string') return null;
        
        let clean = rawString.trim();
        // Corrige quebras de linha literais (\n)
        clean = clean.replace(/\\n/g, '\n');

        // Garante que o Cabeçalho tenha quebra de linha após ele
        const beginRegex = new RegExp(`(-----BEGIN ${type}-----)`, 'g');
        clean = clean.replace(beginRegex, '$1\n');

        // Garante que o Rodapé tenha quebra de linha antes dele
        const endRegex = new RegExp(`(-----END ${type}-----)`, 'g');
        clean = clean.replace(endRegex, '\n$1');

        return clean.trim();
    }

    async authenticate() {
        if (!this.httpsAgent || !this.clientId) {
            throw new Error('Configuração da Cora inválida ou certificado ilegível.');
        }

        try {
            // Envia como form-urlencoded (Correção anterior mantida)
            const params = new URLSearchParams();
            params.append('grant_type', 'client_credentials');
            params.append('client_id', this.clientId);

            const response = await axios.post(this.authUrl, params, {
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

    /**
     * Busca lista de faturas PAGAS (Bulk Sync)
     */
    async getPaidInvoices(daysAgo = 60) {
        // Se falhar a autenticação, ele joga o erro aqui e nem tenta buscar
        const token = await this.authenticate();
        
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysAgo);
        const fmtDate = (d) => d.toISOString().split('T')[0];

        let allPaidIds = [];
        let page = 1;
        let hasMore = true;

        console.log(`🔵 [CoraGateway] Buscando faturas PAGAS de ${fmtDate(startDate)} até ${fmtDate(endDate)}...`);

        while (hasMore) {
            try {
                // Removemos o X-API-Key pois na rota mTLS o certificado + Bearer já autenticam
                const response = await axios.get(`${this.baseUrl}/v2/invoices`, {
                    httpsAgent: this.httpsAgent,
                    headers: { 
                        'Authorization': `Bearer ${token}`
                    },
                    params: {
                        state: 'PAID',
                        start: fmtDate(startDate),
                        end: fmtDate(endDate),
                        perPage: 100,
                        page: page
                    }
                });

                const items = response.data.items || [];
                
                items.forEach(item => {
                    if (item.id) allPaidIds.push(item.id);
                });

                // Se a página vier cheia (100 itens), assumimos que pode ter mais
                if (items.length < 100) {
                    hasMore = false;
                } else {
                    page++;
                }

            } catch (error) {
                // Log detalhado para sabermos se é 401, 403 ou 400
                const status = error.response?.status;
                const data = JSON.stringify(error.response?.data || {});
                console.error(`⚠️ [CoraGateway] Erro na página ${page}: Status ${status} | Resp: ${data}`);
                
                hasMore = false; // Para o loop para não ficar infinito em erro
            }
        }
        
        return allPaidIds;
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