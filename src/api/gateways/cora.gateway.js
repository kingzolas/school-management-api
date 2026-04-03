// src/api/gateways/cora.gateway.js
const axios = require('axios');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { extractCoraBankSlipFields } = require('../utils/boleto.util');

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

  _parseProviderDateValue(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'number') {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;

      // Precedência de datas da Cora:
      // 1) occurrence_date -> data efetiva do pagamento no banco
      // 2) finalized_at -> finalização/compensação do pagamento
      // 3) paid_at -> fallback legado
      //
      // Quando o provider envia apenas YYYY-MM-DD sem hora/timezone, não há
      // timestamp real. Para não "empurrar" a competência para o dia anterior
      // em fusos diferentes, ancoramos o valor ao meio-dia UTC.
      const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnlyMatch) {
        const [, yearRaw, monthRaw, dayRaw] = dateOnlyMatch;
        const year = Number(yearRaw);
        const month = Number(monthRaw);
        const day = Number(dayRaw);
        const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
        return Number.isNaN(d.getTime()) ? null : d;
      }

      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    return null;
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

  _extractPaidAtFromInvoice(data) {
    if (!data) return null;

    const candidates = [
      data.occurrence_date,
      data.occurrenceDate,
      data.finalized_at,
      data.finalizedAt,
      data.paid_at,
      data.paidAt
    ];

    const payments = Array.isArray(data.payments) ? data.payments : [];
    const preferredPayments = payments.filter((p) => {
      const status = String(p?.status || '').trim().toUpperCase();
      return !status || ['SUCCESS', 'PAID', 'LIQUIDATED', 'COMPLETED'].includes(status);
    });

    const orderedPayments = (preferredPayments.length > 0 ? preferredPayments : payments).slice().reverse();

    for (const payment of orderedPayments) {
      candidates.push(
        payment?.occurrence_date || payment?.occurrenceDate || null,
        payment?.finalized_at || payment?.finalizedAt || null,
        payment?.paid_at || payment?.paidAt || null
      );
    }

    for (const candidate of candidates) {
      const parsed = this._parseProviderDateValue(candidate);
      if (parsed) return parsed.toISOString();
    }

    return null;
  }

  _fmtDate(d) {
    return new Date(d).toISOString().split('T')[0];
  }

  _getTotalPagesFromListResponse(data) {
    if (!data) return null;
    // formatos comuns (variam por API)
    const p =
      data.pagination ||
      data.meta?.pagination ||
      data.page_info ||
      data.pageInfo ||
      null;

    const totalPages =
      p?.total_pages ||
      p?.totalPages ||
      data.total_pages ||
      data.totalPages ||
      null;

    if (totalPages && Number(totalPages) > 0) return Number(totalPages);
    return null;
  }

  _getPerPageFromListResponse(data) {
    if (!data) return null;
    const p =
      data.pagination ||
      data.meta?.pagination ||
      data.page_info ||
      data.pageInfo ||
      null;

    const per =
      p?.per_page ||
      p?.perPage ||
      data.per_page ||
      data.perPage ||
      null;

    if (per && Number(per) > 0) return Number(per);
    return null;
  }

  /**
   * ✅ Busca lista de faturas PAGAS (Bulk Sync)
   * A Cora pode ignorar per_page e retornar sempre 20 por página.
   * Então a paginação NÃO pode parar com base em "items.length < perPage".
   */
  async getPaidInvoices(options = {}) {
    const token = await this.authenticate();

    const {
      startDate = null,
      endDate = null,
      states = ['PAID'],
      perPage = 100,
      maxPages = 1000
    } = options || {};

    const end = endDate ? new Date(endDate) : new Date();

    let start = null;
    if (startDate) start = new Date(startDate);
    else {
      start = new Date();
      start.setDate(start.getDate() - 90);
    }

    const fmtStart = this._fmtDate(start);
    const fmtEnd = this._fmtDate(end);

    const paidIdsSet = new Set();

    console.log(`🔵 [CoraGateway] Bulk paid sync (by dueDate/occurrence_date) de ${fmtStart} até ${fmtEnd} | states=${states.join(',')}`);

    for (const state of states) {
      let page = 1;
      let totalPages = null;

      // proteção contra loop por repetição de página
      const pageFingerprints = new Set();

      while (page <= maxPages) {
        const paramsPrimary = {
          state,
          start: fmtStart,
          end: fmtEnd,
          per_page: perPage,
          page
        };

        let data = null;
        let usedFallback = false;

        try {
          data = await this._get('/v2/invoices', token, { params: paramsPrimary });
        } catch (error) {
          // fallback param name perPage
          try {
            const paramsFallback = {
              state,
              start: fmtStart,
              end: fmtEnd,
              perPage: perPage,
              page
            };
            data = await this._get('/v2/invoices', token, { params: paramsFallback });
            usedFallback = true;
          } catch (e2) {
            console.error(`❌ [CoraGateway] Falha GET /v2/invoices (state=${state} page=${page})`);
            break;
          }
        }

        const items = data?.items || [];
        if (totalPages === null) totalPages = this._getTotalPagesFromListResponse(data);

        const respPerPage = this._getPerPageFromListResponse(data);
        const fingerprint = `${state}|${page}|${items.map(i => i?.id).filter(Boolean).slice(0, 10).join(',')}`;
        if (pageFingerprints.has(fingerprint)) {
          console.warn(`⚠️ [CoraGateway] Página repetida detectada (state=${state} page=${page}). Interrompendo para evitar loop.`);
          break;
        }
        pageFingerprints.add(fingerprint);

        console.log(`📄 [CoraGateway] state=${state} page=${page} items=${items.length} ${usedFallback ? '(fallback perPage)' : ''}`, {
          totalPages: totalPages || null,
          respPerPage: respPerPage || null
        });

        for (const item of items) {
          if (item?.id) paidIdsSet.add(String(item.id));
        }

        // ✅ Condições de parada CORRETAS:
        // 1) se API informa totalPages e chegamos no final
        if (totalPages && page >= totalPages) break;

        // 2) se não informa totalPages: continua enquanto vier itens; para apenas quando vier 0
        if (!totalPages && items.length === 0) break;

        // avança página
        page += 1;
      }

      if (page > maxPages) {
        console.warn(`⚠️ [CoraGateway] maxPages atingido (state=${state}). Interrompendo para segurança.`);
      }
    }

    const allPaidIds = Array.from(paidIdsSet);
    console.log(`✅ [CoraGateway] Bulk paid sync finalizado. totalPaidIds=${allPaidIds.length} sample=${allPaidIds.slice(0, 10).join(', ')}`);
    return allPaidIds;
  }

  async getInvoice(externalId) {
    const token = await this.authenticate();
    const data = await this._get(`/v2/invoices/${externalId}`, token);

    console.log('📦 [CoraGateway] getInvoice (raw keys)', {
      externalId: String(externalId),
      keys: data ? Object.keys(data).slice(0, 20) : null
    });

    return data;
  }

  async getInvoicePaymentInfo(externalId) {
    const data = await this.getInvoice(externalId);
    const bankSlip = extractCoraBankSlipFields(data);

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
      paidAt,
      boletoBarcode: bankSlip.barcode,
      boletoDigitableLine: bankSlip.digitableLine
    });

    return {
      status,
      paidAt,
      boleto_url: bankSlip.url,
      boleto_barcode: bankSlip.barcode,
      boleto_digitable_line: bankSlip.digitableLine,
      raw: data,
    };
  }

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
      const boleto = extractCoraBankSlipFields(invoiceData);

      return {
        gateway: 'cora',
        external_id: invoiceData?.id,
        status: 'pending',
        pix_code: null,
        pix_qr_base64: null,
        boleto_url: boleto.url,
        boleto_barcode: boleto.barcode,
        boleto_digitable_line: boleto.digitableLine,
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
