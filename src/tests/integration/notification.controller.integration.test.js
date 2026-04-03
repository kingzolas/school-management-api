const test = require('node:test');
const assert = require('node:assert/strict');

const controller = require('../../api/controllers/notification.controller');
const NotificationService = require('../../api/services/notification.service');

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

test('NotificationController keeps transport-logs contract delegating to the multichannel service', async () => {
  const original = NotificationService.getTransportLogs;
  NotificationService.getTransportLogs = async () => ({
    logs: [{ provider: 'evolution', channel: 'whatsapp', status: 'accepted' }],
    total: 1,
    page: 1,
    pages: 1,
  });

  const req = {
    user: { schoolId: 'school_1' },
    query: { page: '1', limit: '20' },
  };
  const res = createResponse();

  try {
    await controller.getTransportLogs(req, res, (error) => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.total, 1);
    assert.equal(res.payload.logs[0].channel, 'whatsapp');
  } finally {
    NotificationService.getTransportLogs = original;
  }
});

test('NotificationController returns structured batch payload for trigger-month', async () => {
  const originalQueueMonth = NotificationService.queueMonthInvoicesManually;
  const originalProcessQueue = NotificationService.processQueue;

  NotificationService.queueMonthInvoicesManually = async () => ({
    success: true,
    total_analisado: 5,
    total_elegivel: 1,
    total_queued: 1,
    total_skipped: 4,
    total_failed: 0,
    breakdown: {
      NOTIFICATION_QUEUED: 1,
      INVOICE_ALREADY_PAID: 1,
    },
    items: [],
  });
  NotificationService.processQueue = async () => undefined;

  const req = {
    user: { schoolId: 'school_1' },
  };
  const res = createResponse();

  try {
    await controller.triggerMonthInvoices(req, res, (error) => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.total_analisado, 5);
    assert.equal(res.payload.total_queued, 1);
    assert.equal(res.payload.breakdown.INVOICE_ALREADY_PAID, 1);
  } finally {
    NotificationService.queueMonthInvoicesManually = originalQueueMonth;
    NotificationService.processQueue = originalProcessQueue;
  }
});

test('NotificationController returns clear payload for manual enqueue result', async () => {
  const originalEnqueue = NotificationService.enqueueInvoiceManually;
  const originalFindOne = require('../../api/models/invoice.model').findOne;

  NotificationService.enqueueInvoiceManually = async () => ({
    success: true,
    status: 'skipped',
    code: 'INVOICE_ALREADY_PAID',
    category: 'business_rule',
    title: 'Fatura já paga',
    user_message: 'Esta cobrança já foi paga e não será enviada novamente.',
    technical_message: 'Invoice paga.',
    retryable: false,
    field: null,
    item_id: 'inv_1',
    invoice_id: 'inv_1',
  });

  require('../../api/models/invoice.model').findOne = () => ({
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({
        _id: 'inv_1',
        school_id: 'school_1',
        status: 'paid',
      }).then(resolve, reject);
    },
  });

  const req = {
    user: { schoolId: 'school_1' },
    body: { invoiceId: 'inv_1' },
  };
  const res = createResponse();

  try {
    await controller.enqueueInvoice(req, res, (error) => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.status, 'skipped');
    assert.equal(res.payload.code, 'INVOICE_ALREADY_PAID');
  } finally {
    NotificationService.enqueueInvoiceManually = originalEnqueue;
    require('../../api/models/invoice.model').findOne = originalFindOne;
  }
});
