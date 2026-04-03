const test = require('node:test');
const assert = require('node:assert/strict');

const controller = require('../../api/controllers/invoice.controller');
const InvoiceService = require('../../api/services/invoice.service');

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('InvoiceController resend returns clear skipped payload for paid invoices', async () => {
  const original = InvoiceService.resendNotificationWithOutcome;

  InvoiceService.resendNotificationWithOutcome = async () => ({
    success: true,
    status: 'skipped',
    code: 'INVOICE_ALREADY_PAID',
    category: 'business_rule',
    title: 'Fatura já paga',
    user_message: 'Esta cobrança já foi paga e não será enviada novamente.',
    technical_message: 'Invoice paga.',
    retryable: false,
    field: null,
    item_id: 'inv_paid',
    invoice_id: 'inv_paid',
  });

  const req = {
    user: { school_id: 'school_1' },
    params: { id: 'inv_paid' },
  };
  const res = createResponse();

  try {
    await controller.resendWhatsapp(req, res, (error) => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.status, 'skipped');
    assert.equal(res.payload.code, 'INVOICE_ALREADY_PAID');
  } finally {
    InvoiceService.resendNotificationWithOutcome = original;
  }
});
