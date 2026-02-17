// src/api/gateways/cora.gateway.js
const axios = require('axios');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

class CoraGateway {
    constructor(config) {
        this.fullConfig = config;

        // 1) Decide ambiente
        this.isSandbox = this.fullConfig?.isSandbox === true;

        // 2) Seleciona credenciais corretas
        const credentials = this.isSandbox ? this.fullConfig?.sandbox : this.fullConfig?.production;

        // 3) Validação
        if (!credentials || !credentials.clientId || !credentials.certificateContent || !credentials.privateKeyContent) {
            console.error(`❌ [CoraGateway] Credenciais incompletas para o ambiente ${this.isSandbox ? 'SANDBOX' : 'PRODUÇÃO'}.`);
            this.httpsAgent = null;
            this.clientId = null;
            return;
        }

        // 4) Define URLs (mTLS)
        if (this.isSandbox) {
            console.log('🧪 [CoraGateway] Inicializando em modo SANDBOX (mTLS).');
            this.authUrl = 'https://matls-clients.api.stage.cora.com.br/token';
            this.baseUrl = 'https://matls-clients.api.stage.cora.com.br';
        } else {
            console.log('🚀 [CoraGateway] Inicializando em modo PRODUÇÃO (mTLS).');
            this.authUrl = 'https://matls-clients.api.cora.com.br/token';
            this.baseUrl = 'https://matls-clients.api.cora.com.br';
        }

        // 5) Formata PEM
        const cert = this._formatPem(credentials.certificateContent, ['CERTIFICATE']);
        // ✅ Correção importante: a chave pode vir como "PRIVATE KEY" ou "RSA PRIVATE KEY"
        const key = this._formatPem(credentials.privateKeyContent, ['PRIVATE KEY', 'RSA PRIVATE KEY']);

        if (cert && key) {
            this.httpsAgent = new https.Agent({
                cert,
                key,
                rejectUnauthorized: !this.isSandbox
            });
            this.clientId = credentials.clientId;
        } else {
            console.error('❌ [CoraGateway] Falha ao formatar PEM. Verifique se as chaves no banco começam com -----BEGIN...');
            this.httpsAgent = null;
            this.clientId = null;
        }

        // Cache simples do token pra não autenticar a cada request
        this._tokenCache = {
            accessToken: null,
            expiresAt: 0
        };
    }

    _formatPem(rawString, allowedTypes = []) {
        if (!rawString || typeof rawString !== 'string') return null;

        let clean = rawString.trim();
        clean = clean.replace(/\\n/g, '\n'); // Corrige \n literal

        // Se já estiver com BEGIN/END, só garante quebras
        // Se não soubermos o tipo exato, tentamos detectar no próprio texto
        const hasBegin = clean.includes('-----BEGIN ');
        const hasEnd = clean.includes('-----END ');

        if (!hasBegin || !hasEnd) {
            // Se vier só conteúdo base64 sem headers, não dá pra recuperar corretamente aqui
            return null;
        }

        // Normaliza para os tipos permitidos (quando fornecidos)
        if (allowedTypes.length > 0) {
            const ok = allowedTypes.some((t) => clean.includes(`-----BEGIN ${t}-----`));
            if (!ok) {
                // Ainda assim retorna, porque pode ser outro tipo válido, mas loga pra investigação
                console.warn('⚠️ [CoraGateway] Tipo de PEM diferente do esperado. Prosseguindo mesmo assim.');
            }
        }

        // Garante quebra após header e antes do footer
        clean = clean.replace(/(-----BEGIN [^-]+-----)\s*/g, '$1\n');
        clean = clean.replace(/\s*(-----END [^-]+-----)/g, '\n$1');

        return clean.trim();
    }

    _safeJson(obj) {
        try {
            return JSON.stringify(obj);
        } catch (e) {
            return String(obj);
        }
    }

    async authenticate() {
        if (!this.httpsAgent || !this.clientId) {
            throw new Error('Configuração da Cora inválida ou certificado ilegível.');
        }

        // Cache: se ainda válido, reutiliza
        const now = Date.now();
        if (this._tokenCache.accessToken && this._tokenCache.expiresAt > now + 10_000) {
            return this._tokenCache.accessToken;
        }

        try {
            const params = new URLSearchParams();
            params.append('grant_type', 'client_credentials');
            params.append('client_id', this.clientId);

            const response = await axios.post(this.authUrl, params, {
                httpsAgent: this.httpsAgent,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 20000
            });

            const token = response.data?.access_token;
            const expiresIn = Number(response.data?.expires_in || 300); // fallback
            if (!token) throw new Error('Token não retornado pela Cora.');

            this._tokenCache.accessToken = token;
            this._tokenCache.expiresAt = Date.now() + expiresIn * 1000;

            return token;
        } catch (error) {
            const status = error.response?.status;
            const detail = error.response?.data || error.message;
            console.error('[CoraGateway] ❌ Falha Auth:', { status, detail });
            throw new Error(`Falha Auth Cora: ${this._safeJson(detail)}`);
        }
    }

    /**
     * Wrapper de GET com logs úteis (sem vazar token)
     */
    async _get(path, token, { params } = {}) {
        const url = `${this.baseUrl}${path}`;
        try {
            const response = await axios.get(url, {
                httpsAgent: this.httpsAgent,
                headers: { Authorization: `Bearer ${token}` },
                params,
                timeout: 25000
            });
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            console.error(`⚠️ [CoraGateway] GET ${path} falhou`, {
                status,
                params,
                response: data ? this._safeJson(data) : error.message
            });
            throw error;
        }
    }

    /**
     * Wrapper de POST com logs úteis (sem vazar token)
     */
    async _post(path, token, body, { headers } = {}) {
        const url = `${this.baseUrl}${path}`;
        try {
            const response = await axios.post(url, body, {
                httpsAgent: this.httpsAgent,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Idempotency-Key': uuidv4(),
                    ...(headers || {})
                },
                timeout: 25000
            });
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            console.error(`⚠️ [CoraGateway] POST ${path} falhou`, {
                status,
                response: data ? this._safeJson(data) : error.message
            });
            throw error;
        }
    }

    /**
     * Busca lista de faturas PAGAS (Bulk Sync)
     * ✅ Ajustes:
     * - tenta state PAID e LIQUIDATED (varia conforme API / evento)
     * - usa per_page (muito comum) e mantém perPage como fallback
     * - logs de paginação e amostras
     */
    async getPaidInvoices(daysAgo = 60) {
        const token = await this.authenticate();

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysAgo);

        const fmtDate = (d) => d.toISOString().split('T')[0];

        const statesToTry = ['PAID', 'LIQUIDATED'];
        const paidIdsSet = new Set();

        console.log(`🔵 [CoraGateway] Bulk paid sync de ${fmtDate(startDate)} até ${fmtDate(endDate)} | states=${statesToTry.join(',')}`);

        for (const state of statesToTry) {
            let page = 1;
            let hasMore = true;

            while (hasMore) {
                try {
                    const params = {
                        state,
                        start: fmtDate(startDate),
                        end: fmtDate(endDate),
                        // ✅ primeiro tenta padrão mais comum
                        per_page: 100,
                        page
                    };

                    const data = await this._get('/v2/invoices', token, { params });

                    const items = data?.items || [];
                    // Log leve por página
                    console.log(`📄 [CoraGateway] state=${state} page=${page} items=${items.length}`);

                    for (const item of items) {
                        if (item?.id) paidIdsSet.add(String(item.id));
                    }

                    // Critério: se veio menos que 100, acabou
                    if (items.length < 100) {
                        hasMore = false;
                    } else {
                        page++;
                    }
                } catch (error) {
                    // Para este state ao falhar (evita loop infinito)
                    hasMore = false;

                    // ✅ fallback: tenta perPage se per_page não funcionar (algumas APIs usam camelCase)
                    try {
                        const paramsFallback = {
                            state,
                            start: fmtDate(startDate),
                            end: fmtDate(endDate),
                            perPage: 100,
                            page
                        };

                        const dataFb = await this._get('/v2/invoices', token, { params: paramsFallback });
                        const itemsFb = dataFb?.items || [];
                        console.log(`📄 [CoraGateway] (fallback perPage) state=${state} page=${page} items=${itemsFb.length}`);

                        for (const item of itemsFb) {
                            if (item?.id) paidIdsSet.add(String(item.id));
                        }

                        if (itemsFb.length < 100) hasMore = false;
                        else page++;
                    } catch (e2) {
                        console.error(`❌ [CoraGateway] Falha também no fallback perPage (state=${state} page=${page})`);
                        hasMore = false;
                    }
                }
            }
        }

        const allPaidIds = Array.from(paidIdsSet);
        console.log(`✅ [CoraGateway] Bulk paid sync finalizado. totalPaidIds=${allPaidIds.length} sample=${allPaidIds.slice(0, 5).join(', ')}`);

        return allPaidIds;
    }

    /**
     * ✅ Método individual para fallback do sync:
     * tenta buscar a fatura e retornar um status coerente para o InvoiceService.
     */
    async getInvoiceStatus(externalId) {
        const token = await this.authenticate();

        const data = await this._get(`/v2/invoices/${externalId}`, token);

        // Aqui varia conforme retorno da Cora; por isso checamos campos comuns
        const status =
            data?.state ||
            data?.status ||
            data?.invoice_state ||
            data?.invoiceStatus ||
            null;

        // Log para diagnosticar formato real
        console.log('🔎 [CoraGateway] getInvoiceStatus', {
            externalId: String(externalId),
            status,
            keys: data ? Object.keys(data).slice(0, 20) : null
        });

        return status;
    }

    async createInvoice(data) {
        const token = await this.authenticate();
        const { value, description, dueDate, payer, internalId } = data;

        const dataVencimento = new Date(dueDate).toISOString().split('T')[0];
        const nomeCliente = payer?.name ? payer.name.substring(0, 60) : 'Cliente';

        const body = {
            code: internalId ? internalId.toString() : uuidv4(),
            customer: {
                name: nomeCliente,
                email: payer?.email,
                document: {
                    identity: (payer?.cpf || '').replace(/\D/g, ''),
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
            const invoiceData = await this._post('/v2/invoices', token, body);

            const boleto = invoiceData?.payment_options?.bank_slip || {};

            return {
                gateway: 'cora',
                external_id: invoiceData?.id,
                status: 'pending',
                pix_code: null,
                pix_qr_base64: null,
                boleto_url: boleto?.url,
                boleto_barcode: boleto?.barcode,
                boleto_digitable: boleto?.digitable_line,
                raw: invoiceData
            };
        } catch (error) {
            const detail = error.response?.data || error.message;
            console.error('[CoraGateway] ❌ Erro Create:', detail);
            throw new Error(`Erro Cora Create: ${this._safeJson(detail)}`);
        }
    }

    async cancelInvoice(externalId) {
        // Se você quiser implementar depois, precisa confirmar o endpoint correto de cancelamento.
        // Por enquanto mantém como no seu código original.
        return null;
    }
}

module.exports = CoraGateway;
