const test = require('node:test');
const assert = require('node:assert/strict');

const { NotificationLogService } = require('../../api/services/notificationLog.service');

function createQuery(data) {
  return {
    _data: data,
    sort() {
      return this;
    },
    lean() {
      return Promise.resolve(this._data);
    },
    then(resolve, reject) {
      return this.lean().then(resolve, reject);
    },
  };
}

test('findExistingLogForDay ignores failed, skipped and cancelled logs for same-day deduplication', async () => {
  const logs = [
    {
      _id: 'failed_log',
      school_id: 'school_1',
      invoice_id: 'invoice_1',
      status: 'failed',
      delivery_channel: 'email',
      target_email: 'resp@example.com',
      business_day: '2026-04-06',
      createdAt: new Date('2026-04-06T13:00:00.000Z'),
    },
    {
      _id: 'skipped_log',
      school_id: 'school_1',
      invoice_id: 'invoice_1',
      status: 'skipped',
      delivery_channel: 'email',
      target_email: 'resp@example.com',
      business_day: '2026-04-06',
      createdAt: new Date('2026-04-06T14:00:00.000Z'),
    },
    {
      _id: 'cancelled_log',
      school_id: 'school_1',
      invoice_id: 'invoice_1',
      status: 'cancelled',
      delivery_channel: 'email',
      target_email: 'resp@example.com',
      business_day: '2026-04-06',
      createdAt: new Date('2026-04-06T15:00:00.000Z'),
    },
  ];

  const service = new NotificationLogService({
    NotificationLogModel: {
      find() {
        return createQuery(logs);
      },
      buildMinimalRecipientSnapshot(input = {}) {
        return {
          role: input.recipient_role || 'unknown',
          name: input.recipient_name || null,
          email: input.target_email || null,
          email_normalized: input.target_email_normalized || input.target_email || null,
          phone: input.target_phone || null,
          phone_normalized: input.target_phone_normalized || null,
        };
      },
    },
    timeZone: 'America/Sao_Paulo',
  });

  const result = await service.findExistingLogForDay({
    schoolId: 'school_1',
    invoiceId: 'invoice_1',
    channel: 'email',
    email: 'resp@example.com',
    referenceDate: new Date('2026-04-06T16:00:00.000Z'),
  });

  assert.equal(result.existing, null);
  assert.equal(result.businessDay, '2026-04-06');
});

test('findExistingLogForDay still blocks queued, processing and sent logs on the same business day', async () => {
  const logs = [
    {
      _id: 'queued_log',
      school_id: 'school_1',
      invoice_id: 'invoice_1',
      status: 'queued',
      delivery_channel: 'email',
      target_email: 'resp@example.com',
      business_day: '2026-04-06',
      createdAt: new Date('2026-04-06T13:00:00.000Z'),
    },
  ];

  const service = new NotificationLogService({
    NotificationLogModel: {
      find() {
        return createQuery(logs);
      },
      buildMinimalRecipientSnapshot(input = {}) {
        return {
          role: input.recipient_role || 'unknown',
          name: input.recipient_name || null,
          email: input.target_email || null,
          email_normalized: input.target_email_normalized || input.target_email || null,
          phone: input.target_phone || null,
          phone_normalized: input.target_phone_normalized || null,
        };
      },
    },
    timeZone: 'America/Sao_Paulo',
  });

  const result = await service.findExistingLogForDay({
    schoolId: 'school_1',
    invoiceId: 'invoice_1',
    channel: 'email',
    email: 'resp@example.com',
    referenceDate: new Date('2026-04-06T16:00:00.000Z'),
  });

  assert.equal(result.existing?._id, 'queued_log');
});
