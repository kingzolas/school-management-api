const { DEFAULT_TIME_ZONE, getBusinessDayDifference, getTimeZoneParts } = require('../utils/timeContext');
const {
  extractDigitableLineFromInvoice,
  normalizeBarcode,
  normalizeDigitableLine,
} = require('../utils/boleto.util');

const AVISO_LIQUIDACAO =
  '\n\nObservação: se o pagamento já foi realizado, por favor desconsidere esta mensagem. A compensação bancária pode levar até 3 dias úteis para ser refletida em nosso sistema.';

const TEMPLATES_FUTURO = [
  `{saudacao}, {nome}.\nA cobrança referente a {descricao}, da {escola}, já está disponível para pagamento.\nVencimento: {vencimento}\nValor: R$ {valor}.${AVISO_LIQUIDACAO}`,
  `{saudacao}, {nome}.\nEncaminhamos a cobrança de {descricao}, da {escola}, com vencimento em {vencimento}.\nValor: R$ {valor}.${AVISO_LIQUIDACAO}`,
  `{saudacao}, {nome}.\nA mensalidade de {descricao}, da {escola}, já foi emitida.\nAbaixo seguem os dados para pagamento até {vencimento}.${AVISO_LIQUIDACAO}`,
  `{saudacao}, {nome}.\nSegue a cobrança de {descricao}, da {escola}, para sua organização financeira.\nVencimento: {vencimento}\nValor: R$ {valor}.${AVISO_LIQUIDACAO}`,
];

const TEMPLATES_HOJE = [
  `{saudacao}, {nome}.\nEste é um lembrete de que a cobrança de {descricao}, da {escola}, vence hoje.\nValor: R$ {valor}.${AVISO_LIQUIDACAO}`,
  `{saudacao}, {nome}.\nInformamos que a mensalidade de {descricao}, da {escola}, vence hoje.\nAbaixo estão os dados para pagamento.${AVISO_LIQUIDACAO}`,
  `{saudacao}, {nome}.\nPassando para lembrar que a cobrança de {descricao} vence hoje.\nSe precisar, os dados de pagamento estão logo abaixo.${AVISO_LIQUIDACAO}`,
];

const TEMPLATES_ATRASO = [
  `{saudacao}, {nome}.\nIdentificamos que a cobrança de {descricao}, da {escola}, com vencimento em {vencimento}, ainda consta em aberto.\nAtraso atual: {dias_atraso} dia(s).${AVISO_LIQUIDACAO}`,
  `{saudacao}, {nome}.\nAté o momento, não identificamos o pagamento da cobrança de {descricao}, da {escola}.\nPara facilitar a regularização, enviamos os dados atualizados abaixo.${AVISO_LIQUIDACAO}`,
  `{saudacao}, {nome}.\nA cobrança de {descricao}, da {escola}, permanece em aberto desde {vencimento}.\nSe precisar de apoio para regularização, basta responder a este e-mail.${AVISO_LIQUIDACAO}`,
];

const ASSINATURA = '\n\nAtenciosamente,\nEquipe Financeira\n{escola}';

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getSaudacao(referenceDate = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const h = getTimeZoneParts(referenceDate, timeZone).hour;
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function formatCurrency(value = 0) {
  return (Number(value || 0) / 100).toFixed(2).replace('.', ',');
}

function formatDateBr(value) {
  const date = normalizeDate(value);
  if (!date) return '--/--/----';
  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function buildSafeFileName(studentName, invoiceId, dueDate) {
  const safeName = (studentName || 'Aluno')
    .split(' ')[0]
    .replace(/[^a-zA-Z0-9]/g, '_');

  const venc = normalizeDate(dueDate) || new Date();
  const dueKey = `${venc.getUTCFullYear()}-${String(venc.getUTCMonth() + 1).padStart(2, '0')}-${String(venc.getUTCDate()).padStart(2, '0')}`;

  return `Boleto_${safeName}_${String(invoiceId)}_${dueKey}.pdf`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class BillingMessageComposerService {
  _selectTemplateGroup(
    notificationLog = {},
    invoice = {},
    referenceDate = new Date(),
    businessTimeZone = DEFAULT_TIME_ZONE
  ) {
    const type = String(notificationLog.type || '').toLowerCase();
    if (type === 'new_invoice' || type === 'reminder') {
      return { group: 'FUTURO', list: TEMPLATES_FUTURO };
    }
    if (type === 'due_today') {
      return { group: 'HOJE', list: TEMPLATES_HOJE };
    }
    if (type === 'overdue') {
      return { group: 'ATRASO', list: TEMPLATES_ATRASO };
    }

    const venc = normalizeDate(invoice.dueDate) || referenceDate;
    const diffDays = getBusinessDayDifference(venc, referenceDate, businessTimeZone);

    if (diffDays > 0) return { group: 'FUTURO', list: TEMPLATES_FUTURO };
    if (diffDays < 0) return { group: 'ATRASO', list: TEMPLATES_ATRASO };
    return { group: 'HOJE', list: TEMPLATES_HOJE };
  }

  _resolveDigitableLine(invoice = {}) {
    const digitableLine = extractDigitableLineFromInvoice(invoice);
    if (digitableLine) return digitableLine;

    const rawCandidate = normalizeString(
      invoice?.boleto_digitable_line ||
      invoice?.boleto_digitable ||
      invoice?.digitable_line ||
      invoice?.digitable ||
      invoice?.boleto_barcode
    );

    if (rawCandidate) {
      console.warn('[BillingMessageComposer] Linha digitavel invalida e omitida do e-mail.', {
        invoiceId: invoice?._id ? String(invoice._id) : null,
        externalId: invoice?.external_id ? String(invoice.external_id) : null,
        rawCandidate,
      });
    }

    return null;
  }

  _resolveBarcode(invoice = {}) {
    return normalizeBarcode(invoice?.boleto_barcode);
  }

  _resolvePix(invoice = {}) {
    return normalizeString(invoice.pix_code || invoice.mp_pix_copia_e_cola);
  }

  _shouldAttachPdf(invoice = {}) {
    const boletoUrl = normalizeString(invoice.boleto_url);
    if (!boletoUrl) return false;

    const gateway = String(invoice.gateway || '').toLowerCase();
    if (gateway === 'cora') return true;
    return /\.pdf(\?|$)/i.test(boletoUrl);
  }

  _buildAttachmentsPlan({ invoice, notificationLog, config }) {
    const attachPdf = config?.channels?.email?.attachBoletoPdf !== false;
    const boletoUrl = normalizeString(invoice?.boleto_url);

    if (!attachPdf || !boletoUrl || !this._shouldAttachPdf(invoice)) {
      return [];
    }

    return [{
      type: 'boleto_pdf',
      filename: buildSafeFileName(
        notificationLog?.student_name || notificationLog?.recipient_name || 'Aluno',
        invoice?._id || 'invoice',
        invoice?.dueDate
      ),
      sourceUrl: boletoUrl,
      mimeType: 'application/pdf',
      required: false,
      fallbackToLink: true,
    }];
  }

  _buildSections({ baseText, invoice, signature = null }) {
    const sections = [];
    const addSection = (value) => {
      const normalized = normalizeString(value);
      if (normalized) sections.push(normalized);
    };

    addSection(baseText);

    const paymentLink = normalizeString(invoice?.boleto_url);
    const digitableLine = this._resolveDigitableLine(invoice);
    const barcode = this._resolveBarcode(invoice);
    const pix = this._resolvePix(invoice);

    if (paymentLink) {
      addSection(`Link para pagamento:\n${paymentLink}`);
    }

    if (digitableLine) {
      addSection(`Linha digitável:\n${digitableLine}`);
    }

    if (pix) {
      addSection(`PIX copia e cola:\n${pix}`);
    }

    addSection(signature);

    return {
      text: sections.join('\n\n'),
      paymentLink,
      digitableLine,
      barcode,
      pix,
    };
  }

  _buildEmailHtml({ baseText, sections, signature = null }) {
    const paragraphs = String(baseText || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => `<p>${escapeHtml(item)}</p>`);

    if (sections.paymentLink) {
      paragraphs.push(
        `<p><strong>Link para pagamento:</strong><br><a href="${escapeHtml(sections.paymentLink)}">${escapeHtml(sections.paymentLink)}</a></p>`
      );
    }

    if (sections.digitableLine) {
      paragraphs.push(
        `<p><strong>Linha digitável:</strong><br>${escapeHtml(sections.digitableLine)}</p>`
      );
    }

    if (sections.pix) {
      paragraphs.push(
        `<p><strong>PIX copia e cola:</strong><br>${escapeHtml(sections.pix)}</p>`
      );
    }

    if (signature) {
      paragraphs.push(
        ...String(signature)
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => `<p>${escapeHtml(item)}</p>`)
      );
    }

    return [
      '<html><head><meta charset="UTF-8"></head><body style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">',
      ...paragraphs,
      '</body></html>',
    ].join('');
  }

  compose({ notificationLog, invoice, school, config, referenceDate = new Date() }) {
    const businessTimeZone = normalizeString(
      notificationLog?.business_timezone ||
      config?.businessTimeZone ||
      school?.timeZone ||
      school?.timezone
    ) || DEFAULT_TIME_ZONE;

    const { group, list } = this._selectTemplateGroup(
      notificationLog,
      invoice,
      referenceDate,
      businessTimeZone
    );
    const templateIndex = Number.isInteger(notificationLog?.template_index) && list[notificationLog.template_index]
      ? notificationLog.template_index
      : Math.floor(Math.random() * list.length);

    const template = list[templateIndex];
    const dueDate = normalizeDate(invoice?.dueDate) || new Date();
    const diffDays = getBusinessDayDifference(dueDate, referenceDate, businessTimeZone);
    const diasAtraso = diffDays < 0 ? Math.abs(diffDays) : 0;

    const schoolName = normalizeString(school?.name) || 'Escola';
    const recipientName = normalizeString(
      notificationLog?.recipient_snapshot?.first_name ||
      notificationLog?.recipient_name ||
      notificationLog?.tutor_name ||
      notificationLog?.student_name
    ) || 'Olá';

    const baseText = template
      .replace(/{escola}/g, schoolName)
      .replace(/{nome}/g, recipientName.split(' ')[0] || recipientName)
      .replace(/{descricao}/g, normalizeString(invoice?.description) || 'mensalidade')
      .replace(/{valor}/g, formatCurrency(invoice?.value))
      .replace(/{vencimento}/g, formatDateBr(invoice?.dueDate))
      .replace(/{saudacao}/g, getSaudacao(referenceDate, businessTimeZone))
      .replace(/{dias_atraso}/g, String(diasAtraso))
      .replace(/\{AVISO_LIQUIDACAO\}/g, AVISO_LIQUIDACAO);

    const signature = ASSINATURA.replace(/{escola}/g, schoolName);
    const sections = this._buildSections({ baseText, invoice, signature });
    const attachmentsPlan = this._buildAttachmentsPlan({ invoice, notificationLog, config });
    const subjectPrefix = normalizeString(config?.channels?.email?.subjectPrefix);
    const subjectBase = `Cobrança | ${schoolName} | vencimento ${formatDateBr(invoice?.dueDate)}`;
    const subject = subjectPrefix ? `${subjectPrefix} ${subjectBase}` : subjectBase;

    const transportHints = {
      whatsapp: {
        shouldTryFile: attachmentsPlan.length > 0 && config?.channels?.whatsapp?.sendPdfWhenAvailable !== false,
      },
      email: {
        attachBoletoPdf: attachmentsPlan.length > 0,
      },
    };

    return {
      template_group: group,
      template_index: templateIndex,
      subject,
      text: sections.text,
      html: this._buildEmailHtml({ baseText, sections, signature }),
      attachmentsPlan,
      message_preview: sections.text.length > 140 ? `${sections.text.slice(0, 140)}...` : sections.text,
      payment_link: sections.paymentLink || null,
      barcode: sections.barcode || null,
      digitable_line: sections.digitableLine || null,
      pix_code: sections.pix || null,
      transportHints,
    };
  }
}

const service = new BillingMessageComposerService();

module.exports = service;
module.exports.BillingMessageComposerService = BillingMessageComposerService;
