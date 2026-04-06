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

test('NotificationController starts month release in background with queue snapshot', async () => {
  const originalTriggerMonth = NotificationService.triggerMonthReleaseInBackground;

  NotificationService.triggerMonthReleaseInBackground = async () => ({
    started: true,
    alreadyRunning: false,
    startedAt: new Date('2026-04-06T16:30:00.000Z'),
    snapshot: {
      queued: 3,
      processing: 1,
      paused: 2,
    },
  });

  const req = {
    user: { schoolId: 'school_1' },
  };
  const res = createResponse();

  try {
    await controller.triggerMonthInvoices(req, res, (error) => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.background_started, true);
    assert.equal(res.payload.code, 'MONTH_RELEASE_STARTED');
    assert.equal(res.payload.total_queued, 3);
    assert.equal(res.payload.total_paused, 2);
  } finally {
    NotificationService.triggerMonthReleaseInBackground = originalTriggerMonth;
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

test('NotificationController returns clear payload for queue clear action', async () => {
  const originalClearQueue = NotificationService.clearPendingQueue;

  NotificationService.clearPendingQueue = async () => ({
    success: true,
    total_analisado: 5,
    total_cancelled: 3,
    total_already_processed: 1,
    total_untouched: 1,
    total_queued: 0,
    total_skipped: 0,
    total_failed: 0,
    breakdown: {
      QUEUE_CLEAR_CANCELLED: 3,
      QUEUE_CLEAR_ACTIVE_PROCESSING_UNTOUCHED: 1,
    },
    items: [],
    user_message:
      '3 itens pendentes foram removidos da fila. O histórico de envios foi preservado.',
  });

  const req = {
    user: { schoolId: 'school_1' },
  };
  const res = createResponse();

  try {
    await controller.clearQueue(req, res, (error) => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.total_cancelled, 3);
    assert.equal(res.payload.total_untouched, 1);
  } finally {
    NotificationService.clearPendingQueue = originalClearQueue;
  }
});
