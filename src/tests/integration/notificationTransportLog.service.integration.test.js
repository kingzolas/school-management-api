const test = require('node:test');
const assert = require('node:assert/strict');

const { NotificationTransportLogService } = require('../../api/services/notificationTransportLog.service');

function createQuery(value) {
  return {
    _value: value,
    sort() { return this; },
    select() { return this; },
    lean() { return Promise.resolve(this._value); },
    then(resolve, reject) { return this.lean().then(resolve, reject); },
  };
}

function createInMemoryTransportModel() {
  const store = [];

  class InMemoryTransportModel {
    constructor(doc = {}) {
      Object.assign(this, JSON.parse(JSON.stringify(doc)));
    }

    async save() {
      const plain = JSON.parse(JSON.stringify(this));
      const index = store.findIndex((item) => item._id === plain._id);
      if (index >= 0) {
        store[index] = plain;
      } else {
        store.push(plain);
      }
      return this;
    }

    static async create(doc) {
      const instance = new InMemoryTransportModel({
        _id: `attempt_${store.length + 1}`,
        ...doc,
      });
      await instance.save();
      return instance;
    }

    static findOne(filter = {}) {
      const matches = store.filter((item) => (
        (!filter.notification_log_id || item.notification_log_id === filter.notification_log_id)
      ));

      const sorted = matches.sort((left, right) => (right.attempt_number || 0) - (left.attempt_number || 0));
      return createQuery(sorted[0] || null);
    }

    static async findById(id) {
      const found = store.find((item) => item._id === id);
      return found ? new InMemoryTransportModel(found) : null;
    }
  }

  return { InMemoryTransportModel, store };
}

test('NotificationTransportLogService increments attempt_number and syncs parent log summary', async () => {
  const updates = [];
  const { InMemoryTransportModel, store } = createInMemoryTransportModel();

  const service = new NotificationTransportLogService({
    NotificationTransportLogModel: InMemoryTransportModel,
    notificationLogService: {
      async updateLogById(logId, patch) {
        updates.push({ logId, patch });
        return { _id: logId, ...patch };
      },
    },
  });

  const first = await service.createAttempt({
    schoolId: 'school_1',
    notificationLogId: 'log_1',
    invoiceId: 'inv_1',
    channel: 'whatsapp',
    provider: 'evolution',
    destination: '5511999999999',
    destinationPhone: '5511999999999',
  });

  const second = await service.createAttempt({
    schoolId: 'school_1',
    notificationLogId: 'log_1',
    invoiceId: 'inv_1',
    channel: 'whatsapp',
    provider: 'evolution',
    destination: '5511999999999',
    destinationPhone: '5511999999999',
  });

  assert.equal(first.attempt_number, 1);
  assert.equal(second.attempt_number, 2);
  assert.equal(store.length, 2);

  const accepted = await service.markAccepted(second._id, {
    providerMessageId: 'provider_msg_1',
    providerStatus: 'PENDING',
  });

  assert.equal(accepted.canonical_status, 'accepted');
  assert.equal(accepted.provider_message_id, 'provider_msg_1');
  assert.equal(updates.at(-1).patch.last_transport_canonical_status, 'accepted');
  assert.equal(updates.at(-1).patch.attempts, 2);
});

test('NotificationTransportLogService promotes delivered/read states without losing the same attempt', async () => {
  const { InMemoryTransportModel } = createInMemoryTransportModel();

  const service = new NotificationTransportLogService({
    NotificationTransportLogModel: InMemoryTransportModel,
    notificationLogService: {
      async updateLogById() {
        return null;
      },
    },
  });

  const attempt = await service.createAttempt({
    schoolId: 'school_1',
    notificationLogId: 'log_1',
    channel: 'whatsapp',
    provider: 'evolution',
    destination: '5511999999999',
    destinationPhone: '5511999999999',
  });

  await service.markSent(attempt._id, { providerStatus: 'SERVER_ACK' });
  await service.markDelivered(attempt._id, { providerStatus: 'DELIVERY_ACK' });
  const readAttempt = await service.markRead(attempt._id, { providerStatus: 'READ' });

  assert.equal(readAttempt.canonical_status, 'read');
  assert.ok(readAttempt.sent_at);
  assert.ok(readAttempt.delivered_at);
  assert.ok(readAttempt.read_at);
});
