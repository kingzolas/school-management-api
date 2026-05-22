const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const Invoice = require('../../api/models/invoice.model');
const School = require('../../api/models/school.model');
const GatewayFactory = require('../../api/gateways/gateway.factory');
const CoraGateway = require('../../api/gateways/cora.gateway');
const InvoiceService = require('../../api/services/invoice.service');

function createMockInvoice(overrides = {}) {
  return {
    _id: overrides._id || 'invoice_1',
    school_id: overrides.school_id || 'school_1',
    status: overrides.status || 'pending',
    gateway: overrides.gateway === undefined ? 'cora' : overrides.gateway,
    external_id: overrides.external_id === undefined ? 'inv_123' : overrides.external_id,
    tutor: overrides.tutor || null,
    saved: false,
    async save() {
      this.saved = true;
      return this;
    },
  };
}

async function withPatchedInvoiceCancel(deps, fn) {
  const original = {
    invoiceFindOne: Invoice.findOne,
    schoolFindById: School.findById,
    gatewayCreate: GatewayFactory.create,
    getInvoiceById: InvoiceService.getInvoiceById,
  };

  if (deps.invoiceFindOne) Invoice.findOne = deps.invoiceFindOne;
  if (deps.schoolFindById) School.findById = deps.schoolFindById;
  if (deps.gatewayCreate) GatewayFactory.create = deps.gatewayCreate;
  if (deps.getInvoiceById) InvoiceService.getInvoiceById = deps.getInvoiceById;

  try {
    await fn();
  } finally {
    Invoice.findOne = original.invoiceFindOne;
    School.findById = original.schoolFindById;
    GatewayFactory.create = original.gatewayCreate;
    InvoiceService.getInvoiceById = original.getInvoiceById;
  }
}

test('CoraGateway.cancelInvoice calls DELETE /v2/invoices/{external_id}', async () => {
  const originalDelete = axios.delete;
  const gateway = Object.create(CoraGateway.prototype);
  gateway.baseUrl = 'https://cora.example';
  gateway.httpsAgent = {};
  gateway.authenticate = async () => 'token_123';

  let captured = null;
  axios.delete = async (url, config) => {
    captured = { url, config };
    return { data: { status: 'CANCELED' } };
  };

  try {
    const result = await gateway.cancelInvoice('inv_123');
    assert.equal(captured.url, 'https://cora.example/v2/invoices/inv_123');
    assert.equal(captured.config.headers.Authorization, 'Bearer token_123');
    assert.equal(result.success, true);
    assert.equal(result.externalId, 'inv_123');
    assert.equal(result.providerStatus, 'CANCELED');
  } finally {
    axios.delete = originalDelete;
  }
});

test('InvoiceService.cancelInvoice requires cancellation reason', async () => {
  await assert.rejects(
    () => InvoiceService.cancelInvoice('invoice_1', 'school_1', {}),
    (error) => {
      assert.equal(error.code, 'INVOICE_CANCEL_REASON_REQUIRED');
      return true;
    }
  );
});

test('InvoiceService.cancelInvoice does not mark local invoice canceled when Cora fails', async () => {
  const invoice = createMockInvoice();

  await withPatchedInvoiceCancel(
    {
      invoiceFindOne: async () => invoice,
      schoolFindById: () => ({ lean: async () => ({ _id: 'school_1' }) }),
      gatewayCreate: async () => ({
        cancelInvoice: async () => {
          const error = new Error('Cora unavailable');
          error.code = 'CORA_CANCEL_FAILED';
          throw error;
        },
      }),
      getInvoiceById: async () => invoice,
    },
    async () => {
      await assert.rejects(
        () =>
          InvoiceService.cancelInvoice('invoice_1', 'school_1', {
            reason: 'duplicate',
          }),
        (error) => {
          assert.equal(error.code, 'CORA_CANCEL_FAILED');
          return true;
        }
      );

      assert.equal(invoice.status, 'pending');
      assert.equal(invoice.saved, false);
    }
  );
});

test('InvoiceService.cancelInvoice marks local invoice canceled after Cora succeeds', async () => {
  const invoice = createMockInvoice();

  await withPatchedInvoiceCancel(
    {
      invoiceFindOne: async () => invoice,
      schoolFindById: () => ({ lean: async () => ({ _id: 'school_1' }) }),
      gatewayCreate: async () => ({
        cancelInvoice: async () => ({
          success: true,
          externalId: 'inv_123',
          providerStatus: 'CANCELED',
          raw: { status: 'CANCELED' },
        }),
      }),
      getInvoiceById: async () => invoice,
    },
    async () => {
      const result = await InvoiceService.cancelInvoice(
        'invoice_1',
        'school_1',
        { reason: 'duplicate', note: 'Duplicada' },
        { id: '507f1f77bcf86cd799439011' }
      );

      assert.equal(result.status, 'canceled');
      assert.equal(result.saved, true);
      assert.equal(result.cancellation.reason, 'duplicate');
      assert.equal(result.cancellation.note, 'Duplicada');
      assert.equal(result.gatewaySync.provider, 'cora');
      assert.equal(result.gatewaySync.externalId, 'inv_123');
      assert.equal(result.gatewaySync.status, 'CANCELED');
      assert.equal(result.gatewaySync.cancelStatus, 'success');
    }
  );
});

test('InvoiceService.cancelInvoice keeps local/manual invoices cancellable without gateway call', async () => {
  const invoice = createMockInvoice({ gateway: 'manual', external_id: null });
  let gatewayCalled = false;

  await withPatchedInvoiceCancel(
    {
      invoiceFindOne: async () => invoice,
      gatewayCreate: async () => {
        gatewayCalled = true;
        throw new Error('Gateway should not be called.');
      },
      getInvoiceById: async () => invoice,
    },
    async () => {
      const result = await InvoiceService.cancelInvoice('invoice_1', 'school_1', {
        reason: 'other',
      });

      assert.equal(gatewayCalled, false);
      assert.equal(result.status, 'canceled');
      assert.equal(result.saved, true);
      assert.equal(result.gatewaySync.cancelStatus, 'not_needed');
    }
  );
});

test('InvoiceService.cancelInvoice blocks paid invoices', async () => {
  const invoice = createMockInvoice({ status: 'paid' });

  await withPatchedInvoiceCancel(
    {
      invoiceFindOne: async () => invoice,
    },
    async () => {
      await assert.rejects(
        () =>
          InvoiceService.cancelInvoice('invoice_1', 'school_1', {
            reason: 'duplicate',
          }),
        /PAGA/
      );

      assert.equal(invoice.saved, false);
    }
  );
});

test('InvoiceService.registerManualPayment marks invoice paid and cancels Cora boleto', async () => {
  const invoice = createMockInvoice();

  await withPatchedInvoiceCancel(
    {
      invoiceFindOne: async () => invoice,
      schoolFindById: () => ({ lean: async () => ({ _id: 'school_1' }) }),
      gatewayCreate: async () => ({
        cancelInvoice: async () => ({
          success: true,
          externalId: 'inv_123',
          providerStatus: 'CANCELED',
        }),
      }),
      getInvoiceById: async () => invoice,
    },
    async () => {
      const result = await InvoiceService.registerManualPayment(
        'invoice_1',
        'school_1',
        {
          method: 'pix',
          paidAt: '2026-05-22',
          amount: 50000,
          note: 'Pago por Pix direto para a escola.',
        },
        { id: '507f1f77bcf86cd799439011' },
        {
          originalname: 'comprovante.pdf',
          mimetype: 'application/pdf',
          size: 12,
          buffer: Buffer.from('receipt-file'),
        }
      );

      assert.equal(result.invoice.status, 'paid');
      assert.equal(result.invoice.paymentMethod, 'pix');
      assert.equal(result.invoice.paidAmount, 50000);
      assert.equal(result.invoice.manualPayment.enabled, true);
      assert.equal(result.invoice.manualPayment.method, 'pix');
      assert.equal(result.invoice.manualPayment.amount, 50000);
      assert.equal(result.invoice.manualPayment.receiptUrl, '/api/invoices/invoice_1/manual-payment/receipt');
      assert.equal(result.invoice.manualPayment.receiptFileName, 'comprovante.pdf');
      assert.equal(result.invoice.manualPayment.receiptMimeType, 'application/pdf');
      assert.equal(result.invoice.manualPayment.receiptSize, 12);
      assert.deepEqual(result.invoice.manualPayment.receiptData, Buffer.from('receipt-file'));
      assert.equal(result.invoice.gatewaySync.cancelStatus, 'success');
      assert.equal(result.invoice.gatewaySync.cancelReason, 'paid_outside_gateway');
      assert.equal(result.gatewayWarning, null);
    }
  );
});

test('InvoiceService.registerManualPayment keeps invoice paid when Cora cancel fails', async () => {
  const invoice = createMockInvoice();

  await withPatchedInvoiceCancel(
    {
      invoiceFindOne: async () => invoice,
      schoolFindById: () => ({ lean: async () => ({ _id: 'school_1' }) }),
      gatewayCreate: async () => ({
        cancelInvoice: async () => {
          throw new Error('Cora cancel failed');
        },
      }),
      getInvoiceById: async () => invoice,
    },
    async () => {
      const result = await InvoiceService.registerManualPayment('invoice_1', 'school_1', {
        method: 'pix',
        paidAt: '2026-05-22',
        amount: 50000,
      });

      assert.equal(result.invoice.status, 'paid');
      assert.equal(result.invoice.saved, true);
      assert.equal(result.invoice.gatewaySync.cancelStatus, 'failed');
      assert.match(result.invoice.gatewaySync.lastError, /Cora cancel failed/);
      assert.match(result.gatewayWarning, /boleto Cora ainda pode estar ativo/);
    }
  );
});

test('InvoiceService.registerManualPayment without gateway does not try Cora', async () => {
  const invoice = createMockInvoice({ gateway: 'manual', external_id: null });
  let gatewayCalled = false;

  await withPatchedInvoiceCancel(
    {
      invoiceFindOne: async () => invoice,
      gatewayCreate: async () => {
        gatewayCalled = true;
        throw new Error('Gateway should not be called.');
      },
      getInvoiceById: async () => invoice,
    },
    async () => {
      const result = await InvoiceService.registerManualPayment('invoice_1', 'school_1', {
        method: 'cash',
        paidAt: '2026-05-22',
        amount: 50000,
        cancelGatewayInvoice: true,
      });

      assert.equal(gatewayCalled, false);
      assert.equal(result.invoice.status, 'paid');
      assert.equal(result.invoice.manualPayment.method, 'cash');
      assert.equal(result.invoice.gatewaySync.cancelStatus, 'not_needed');
    }
  );
});

test('InvoiceService.registerManualPayment blocks already paid invoices', async () => {
  const invoice = createMockInvoice({ status: 'paid' });

  await withPatchedInvoiceCancel(
    {
      invoiceFindOne: async () => invoice,
    },
    async () => {
      await assert.rejects(
        () =>
          InvoiceService.registerManualPayment('invoice_1', 'school_1', {
            method: 'pix',
            paidAt: '2026-05-22',
            amount: 50000,
          }),
        (error) => {
          assert.equal(error.code, 'INVOICE_ALREADY_PAID');
          return true;
        }
      );
      assert.equal(invoice.saved, false);
    }
  );
});
