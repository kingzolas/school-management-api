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

    const hasBegin = clean.includes('-----BEGIN ');
    const hasEnd = clean.includes('-----END ');

    if (!hasBegin || !hasEnd) {
      return null;
    }

    if (allowedTypes.length > 0) {
      const ok = allowedTypes.some((t) => clean.includes(`-----BEGIN ${t}-----`));
      if (!ok) {
        console.warn('⚠️ [CoraGateway] Tipo de PEM diferente do esperado. Prosseguindo mesmo assim.');
      }
    }

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
      const expiresIn = Number(response.data?.expires_in || 300);
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
   * ✅ Extrai paidAt REAL do JSON completo da invoice:
   * prioridade: payments[].finalized_at -> paid_at -> null
   */
  _extractPaidAtFromInvoice(data) {
    if (!data) return null;

    // 1) paid_at (quando existir)
    if (data.paid_at) {
      const d = new Date(data.paid_at);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }

    // 2) payments[].finalized_at (melhor e mais comum)
    const payments = Array.isArray(data.payments) ? data.payments : [];
    // pega o último pagamento com finalized_at válido (ou o mais recente)
    const withFinalized = payments
      .map((p) => {
        const iso = p?.finalized_at || p?.finalizedAt || null;
        const status = (p?.status || '').toUpperCase();
        return { iso, status };
      })
      .filter((x) => x.iso);

    if (withFinalized.length > 0) {
      // se tiver SUCCESS, prioriza
      const success = withFinalized.filter((x) => x.status === 'SUCCESS');
      const pick = (success.length > 0 ? success[success.length - 1] : withFinalized[withFinalized.length - 1]);

      const d = new Date(pick.iso);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }

    return null;
  }

  /**
   * Busca lista de faturas PAGAS (Bulk Sync)
   * OBS: isso retorna IDs, mas não garante paidAt.
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
            per_page: 100,
            page
          };

          const data = await this._get('/v2/invoices', token, { params });
          const items = data?.items || [];

          console.log(`📄 [CoraGateway] state=${state} page=${page} items=${items.length}`);

          for (const item of items) {
            if (item?.id) paidIdsSet.add(String(item.id));
          }

          if (items.length < 100) hasMore = false;
          else page++;
        } catch (error) {
          hasMore = false;

          // fallback: perPage
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
   * Busca invoice completa (necessário pra paidAt real)
   */
  async getInvoice(externalId) {
    const token = await this.authenticate();
    const data = await this._get(`/v2/invoices/${externalId}`, token);

    console.log('📦 [CoraGateway] getInvoice (raw keys)', {
      externalId: String(externalId),
      keys: data ? Object.keys(data).slice(0, 20) : null
    });

    return data;
  }

  /**
   * Retorna status + paidAt real (quando pago)
   */
  async getInvoicePaymentInfo(externalId) {
    const data = await this.getInvoice(externalId);

    const status =
      data?.status ||
      data?.state ||
      data?.invoice_state ||
      data?.invoiceStatus ||
      null;

    const paidAt = this._extractPaidAtFromInvoice(data);

    console.log('🔎 [CoraGateway] getInvoicePaymentInfo', {
      externalId: String(externalId),
      status,
      paidAt
    });

    return { status, paidAt, raw: data };
  }

  /**
   * Mantido por compat: retorna só status
   */
  async getInvoiceStatus(externalId) {
    const token = await this.authenticate();
    const data = await this._get(`/v2/invoices/${externalId}`, token);

    const status =
      data?.status ||
      data?.state ||
      data?.invoice_state ||
      data?.invoiceStatus ||
      null;

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
      services: [{ name: description, amount: value }],
      payment_terms: { due_date: dataVencimento }
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
    return null;
  }
}

module.exports = CoraGateway;
