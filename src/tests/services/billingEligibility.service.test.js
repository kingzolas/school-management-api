const test = require('node:test');
const assert = require('node:assert/strict');

const { BillingEligibilityService } = require('../../api/services/billingEligibility.service');

function createService({ compensation = null } = {}) {
  return new BillingEligibilityService({
    invoiceCompensationService: {
      async getCompensationByInvoice() {
        return compensation;
      },
    },
  });
}

test('billing eligibility marks new_invoice on first day of month', async () => {
  const service = createService();

  const result = await service.evaluateInvoice({
    invoice: {
      _id: 'inv-1',
      school_id: 'school-1',
      status: 'pending',
      dueDate: new Date(2026, 3, 15),
    },
    referenceDate: new Date(2026, 3, 1, 10, 0, 0),
  });

  assert.equal(result.isEligible, true);
  assert.equal(result.type, 'new_invoice');
});

test('billing eligibility marks reminder three days before due date', async () => {
  const service = createService();

  const result = await service.evaluateInvoice({
    invoice: {
      _id: 'inv-2',
      school_id: 'school-1',
      status: 'pending',
      dueDate: new Date(2026, 3, 10),
    },
    referenceDate: new Date(2026, 3, 7, 9, 0, 0),
  });

  assert.equal(result.isEligible, true);
  assert.equal(result.type, 'reminder');
});

test('billing eligibility marks due_today on due date', async () => {
  const service = createService();

  const result = await service.evaluateInvoice({
    invoice: {
      _id: 'inv-3',
      school_id: 'school-1',
      status: 'pending',
      dueDate: new Date(2026, 3, 10),
    },
    referenceDate: new Date(2026, 3, 10, 14, 0, 0),
  });

  assert.equal(result.isEligible, true);
  assert.equal(result.type, 'due_today');
});

test('billing eligibility marks overdue up to sixty days', async () => {
  const service = createService();

  const result = await service.evaluateInvoice({
    invoice: {
      _id: 'inv-4',
      school_id: 'school-1',
      status: 'pending',
      dueDate: new Date(2026, 2, 20),
    },
    referenceDate: new Date(2026, 3, 10, 8, 0, 0),
  });

  assert.equal(result.isEligible, true);
  assert.equal(result.type, 'overdue');
});

test('billing eligibility rejects paid and canceled invoices with distinct reasons', async () => {
  const service = createService();

  const paid = await service.evaluateInvoice({
    invoice: {
      _id: 'inv-5',
      school_id: 'school-1',
      status: 'paid',
      dueDate: new Date(2026, 3, 10),
    },
  });

  const canceled = await service.evaluateInvoice({
    invoice: {
      _id: 'inv-6',
      school_id: 'school-1',
      status: 'canceled',
      dueDate: new Date(2026, 3, 10),
    },
  });

  assert.equal(paid.isEligible, false);
  assert.equal(paid.reason, 'INVOICE_ALREADY_PAID');
  assert.equal(canceled.isEligible, false);
  assert.equal(canceled.reason, 'INVOICE_CANCELLED');
});

test('billing eligibility rejects hold/compensation invoices', async () => {
  const service = createService({
    compensation: {
      _id: 'comp-1',
      hold_until: new Date(2026, 3, 20),
    },
  });

  const result = await service.evaluateInvoice({
    invoice: {
      _id: 'inv-7',
      school_id: 'school-1',
      status: 'pending',
      dueDate: new Date(2026, 3, 10),
    },
    referenceDate: new Date(2026, 3, 7, 9, 0, 0),
  });

  assert.equal(result.isEligible, false);
  assert.equal(result.reason, 'HOLD_ACTIVE');
  assert.equal(result.onHold, true);
});
