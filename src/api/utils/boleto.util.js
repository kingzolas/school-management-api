function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function digitsOnly(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const digits = normalized.replace(/\D/g, '');
  return digits || null;
}

function normalizeBarcode(value) {
  const digits = digitsOnly(value);
  return digits && digits.length === 44 ? digits : null;
}

function normalizeDigitableLine(value) {
  const digits = digitsOnly(value);
  return digits && digits.length === 47 ? digits : null;
}

function extractCoraBankSlipFields(payload = {}) {
  const bankSlip =
    payload?.payment_options?.bank_slip ||
    payload?.paymentOptions?.bankSlip ||
    payload?.bank_slip ||
    payload?.bankSlip ||
    {};

  const url = normalizeString(bankSlip?.url || bankSlip?.pdf_url || bankSlip?.pdfUrl);
  const barcode = normalizeBarcode(bankSlip?.barcode || bankSlip?.bar_code || bankSlip?.barCode);
  const digitableLine = normalizeDigitableLine(
    bankSlip?.digitable_line ||
    bankSlip?.digitableLine ||
    bankSlip?.digitable ||
    bankSlip?.linha_digitavel ||
    bankSlip?.linhaDigitavel
  );
  const ourNumber = normalizeString(bankSlip?.our_number || bankSlip?.ourNumber);

  return {
    url,
    barcode,
    digitableLine,
    ourNumber,
    raw: bankSlip,
  };
}

function extractDigitableLineFromInvoice(invoice = {}) {
  return normalizeDigitableLine(
    invoice?.boleto_digitable_line ||
    invoice?.boleto_digitable ||
    invoice?.digitable_line ||
    invoice?.digitable ||
    invoice?.linha_digitavel ||
    invoice?.linhaDigitavel ||
    invoice?.invoice_snapshot?.boleto_digitable_line ||
    invoice?.invoice_snapshot?.boleto_digitable ||
    invoice?.invoice_snapshot?.digitable_line ||
    invoice?.invoice_snapshot?.digitable ||
    invoice?.invoice_snapshot?.linha_digitavel ||
    invoice?.invoice_snapshot?.linhaDigitavel ||
    invoice?.sent_digitable_line ||
    invoice?.boleto_barcode ||
    invoice?.invoice_snapshot?.boleto_barcode
  );
}

module.exports = {
  digitsOnly,
  normalizeBarcode,
  normalizeDigitableLine,
  extractCoraBankSlipFields,
  extractDigitableLineFromInvoice,
};
