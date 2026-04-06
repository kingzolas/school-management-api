const test = require('node:test');
const assert = require('node:assert/strict');

const NotificationLog = require('../../api/models/notification-log.model');
const NotificationTransportLog = require('../../api/models/notification_transport_log.model');
const WhatsappTransportLog = require('../../api/models/whatsapp_transport_log.model');
const NotificationConfig = require('../../api/models/notification-config.model');
const Invoice = require('../../api/models/invoice.model');
const notificationLogService = require('../../api/services/notificationLog.service');
const notificationRecipientResolverService = require('../../api/services/notificationRecipientResolver.service');
const notificationChannelSelectorService = require('../../api/services/notificationChannelSelector.service');
const billingEligibilityService = require('../../api/services/billingEligibility.service');
const { NotificationService } = require('../../api/services/notification.service');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createQuery(data) {
  return {
    _data: data,
    sort() { return this; },
    select() { return this; },
    skip() { return this; },
    limit() { return this; },
    populate() { return this; },
    lean() {
      return Promise.resolve(deepClone(this._data));
    },
    then(resolve, reject) {
      return this.lean().then(resolve, reject);
    },
  };
}

function matchFilter(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('$in' in value) {
        return value.$in.map(String).includes(String(doc[key]));
      }

      if ('$lte' in value || '$gte' in value) {
        const current = new Date(doc[key] || 0).getTime();
        const lower = value.$gte ? new Date(value.$gte).getTime() : Number.MIN_SAFE_INTEGER;
        const upper = value.$lte ? new Date(value.$lte).getTime() : Number.MAX_SAFE_INTEGER;
        return current >= lower && current <= upper;
      }
    }

    return String(doc[key]) === String(value);
  });
}

function patchMethods(entries) {
  const restores = entries.map(({ target, key, value }) => {
    const original = target[key];
    target[key] = value;
    return () => {
      target[key] = original;
    };
  });

  return () => restores.reverse().forEach((restore) => restore());
}

function createRecipient() {
  return {
    recipient_role: 'tutor',
    recipient_student_id: 'student_1',
    recipient_tutor_id: 'tutor_1',
    recipient_name: 'Responsável Teste',
    student_name: 'Aluno Teste',
    tutor_name: 'Responsável Teste',
    target_phone: null,
    target_phone_normalized: null,
    target_email: 'responsavel@example.com',
    target_email_normalized: 'responsavel@example.com',
    recipient_snapshot: {
      role: 'tutor',
      student_id: 'student_1',
      tutor_id: 'tutor_1',
      name: 'Responsável Teste',
      first_name: 'Responsável',
      phone: null,
      phone_normalized: null,
      email: 'responsavel@example.com',
      email_normalized: 'responsavel@example.com',
    },
  };
}

function createLog(id, patch = {}) {
  const now = new Date('2026-04-03T12:00:00.000Z');
  const recipient = createRecipient();
  return {
    _id: id,
    school_id: 'school_1',
    invoice_id: `invoice_${id}`,
    student_name: recipient.student_name,
    tutor_name: recipient.tutor_name,
    recipient_name: recipient.recipient_name,
    recipient_role: recipient.recipient_role,
    recipient_snapshot: recipient.recipient_snapshot,
    target_phone: recipient.target_phone,
    target_phone_normalized: recipient.target_phone_normalized,
    target_email: recipient.target_email,
    target_email_normalized: recipient.target_email_normalized,
    delivery_channel: 'email',
    provider: 'gmail',
    type: 'manual',
    status: 'queued',
    scheduled_for: now,
    createdAt: now,
    updatedAt: now,
    processing_started_at: null,
    attempts: 0,
    ...patch,
  };
}

function createConfig() {
  return {
    _id: 'config_1',
    school_id: 'school_1',
    isActive: true,
    primaryChannel: 'email',
    allowFallback: false,
    channels: {
      whatsapp: { enabled: false, provider: 'evolution' },
      email: { enabled: true, provider: 'gmail' },
    },
    toObject() {
      return deepClone(this);
    },
  };
}

test('clearPendingQueue cancels queued and stale processing logs without deleting history', async () => {
  const logs = [
    createLog('queued_1', { status: 'queued' }),
    createLog('processing_stale', {
      status: 'processing',
      processing_started_at: new Date('2026-04-03T09:00:00.000Z'),
      updatedAt: new Date('2026-04-03T09:00:00.000Z'),
    }),
    createLog('processing_recent', {
      status: 'processing',
      processing_started_at: new Date(),
      updatedAt: new Date(),
    }),
    createLog('sent_1', { status: 'sent', sent_at: new Date('2026-04-03T10:00:00.000Z') }),
    createLog('failed_1', { status: 'failed', error_code: 'PROVIDER_TEMPORARY_FAILURE' }),
  ];

  const restore = patchMethods([
    {
      target: NotificationLog,
      key: 'find',
      value: (filter = {}) => createQuery(logs.filter((log) => matchFilter(log, filter))),
    },
    {
      target: NotificationTransportLog,
      key: 'findOne',
      value: () => createQuery(null),
    },
    {
      target: WhatsappTransportLog,
      key: 'findOne',
      value: () => createQuery(null),
    },
    {
      target: notificationLogService,
      key: 'markCancelled',
      value: async (logId, patch = {}) => {
        const log = logs.find((item) => item._id === logId);
        Object.assign(log, {
          status: 'cancelled',
          cancelled_at: patch.cancelledAt || new Date(),
          cancelled_by_action: patch.cancelledByAction || null,
          cancelled_reason: patch.cancelledReason || null,
          error_code: patch.errorCode || null,
          error_message: patch.errorMessage || null,
          processing_started_at: null,
        });
        return deepClone(log);
      },
    },
    {
      target: notificationLogService,
      key: 'markSent',
      value: async (logId) => deepClone(logs.find((item) => item._id === logId)),
    },
    {
      target: notificationLogService,
      key: 'resolveRecipient',
      value: (log) => ({
        recipient_role: log.recipient_role,
        recipient_student_id: log.recipient_snapshot?.student_id || null,
        recipient_tutor_id: log.recipient_snapshot?.tutor_id || null,
        recipient_name: log.recipient_name,
        student_name: log.student_name,
        tutor_name: log.tutor_name,
        target_phone: log.target_phone,
        target_phone_normalized: log.target_phone_normalized,
        target_email: log.target_email,
        target_email_normalized: log.target_email_normalized,
        recipient_snapshot: log.recipient_snapshot,
      }),
    },
  ]);

  const service = new NotificationService();
  service.processingStaleTimeoutMinutes = 60;

  try {
    const result = await service.clearPendingQueue('school_1');

    assert.equal(result.success, true);
    assert.equal(result.total_analisado, 3);
    assert.equal(result.total_cancelled, 2);
    assert.equal(result.total_untouched, 1);
    assert.equal(result.total_already_processed, 0);
    assert.equal(result.breakdown.QUEUE_CLEAR_CANCELLED, 2);
    assert.equal(result.breakdown.QUEUE_CLEAR_ACTIVE_PROCESSING_UNTOUCHED, 1);
    assert.equal(logs.find((item) => item._id === 'queued_1').status, 'cancelled');
    assert.equal(logs.find((item) => item._id === 'processing_stale').status, 'cancelled');
    assert.equal(logs.find((item) => item._id === 'processing_recent').status, 'processing');
    assert.equal(logs.find((item) => item._id === 'sent_1').status, 'sent');
    assert.equal(logs.find((item) => item._id === 'failed_1').status, 'failed');
    assert.equal(logs.find((item) => item._id === 'queued_1').cancelled_by_action, 'queue_clear');
    assert.equal(logs.find((item) => item._id === 'queued_1').cancelled_reason, 'manual_queue_reset_before_email_rollout');
  } finally {
    restore();
  }
});

test('clearPendingQueue reconciles accepted processing logs as already processed', async () => {
  const logs = [
    createLog('processing_accepted', {
      status: 'processing',
      processing_started_at: new Date('2026-04-03T11:00:00.000Z'),
      updatedAt: new Date('2026-04-03T11:00:00.000Z'),
    }),
  ];

  const restore = patchMethods([
    {
      target: NotificationLog,
      key: 'find',
      value: (filter = {}) => createQuery(logs.filter((log) => matchFilter(log, filter))),
    },
    {
      target: NotificationTransportLog,
      key: 'findOne',
      value: () => createQuery({
        _id: 'attempt_1',
        status: 'accepted',
        canonical_status: 'accepted',
        accepted_at: new Date('2026-04-03T11:01:00.000Z'),
        attempt_number: 1,
      }),
    },
    {
      target: WhatsappTransportLog,
      key: 'findOne',
      value: () => createQuery(null),
    },
    {
      target: notificationLogService,
      key: 'markSent',
      value: async (logId, patch = {}) => {
        const log = logs.find((item) => item._id === logId);
        Object.assign(log, {
          status: 'sent',
          sent_at: patch.sentAt,
          last_transport_canonical_status: patch.transportLog?.canonical_status || null,
        });
        return deepClone(log);
      },
    },
    {
      target: notificationLogService,
      key: 'markCancelled',
      value: async (logId) => deepClone(logs.find((item) => item._id === logId)),
    },
    {
      target: notificationLogService,
      key: 'resolveRecipient',
      value: (log) => ({
        recipient_role: log.recipient_role,
        recipient_student_id: log.recipient_snapshot?.student_id || null,
        recipient_tutor_id: log.recipient_snapshot?.tutor_id || null,
        recipient_name: log.recipient_name,
        student_name: log.student_name,
        tutor_name: log.tutor_name,
        target_phone: log.target_phone,
        target_phone_normalized: log.target_phone_normalized,
        target_email: log.target_email,
        target_email_normalized: log.target_email_normalized,
        recipient_snapshot: log.recipient_snapshot,
      }),
    },
  ]);

  const service = new NotificationService();

  try {
    const result = await service.clearPendingQueue('school_1');

    assert.equal(result.total_cancelled, 0);
    assert.equal(result.total_already_processed, 1);
    assert.equal(logs[0].status, 'sent');
    assert.equal(logs[0].last_transport_canonical_status, 'accepted');
  } finally {
    restore();
  }
});

test('processQueue ignores cancelled logs entirely', async () => {
  const logs = [
    createLog('cancelled_1', {
      status: 'cancelled',
      scheduled_for: new Date('2026-04-03T09:00:00.000Z'),
    }),
  ];
  let dispatchCalls = 0;

  const restore = patchMethods([
    {
      target: NotificationLog,
      key: 'find',
      value: (filter = {}) => createQuery(logs.filter((log) => matchFilter(log, filter))),
    },
    {
      target: NotificationConfig,
      key: 'find',
      value: () => createQuery([createConfig()]),
    },
  ]);

  const service = new NotificationService();
  service.dispatchService = {
    async dispatch() {
      dispatchCalls += 1;
      return {};
    },
  };

  try {
    await service.processQueue({ schoolId: 'school_1' });
    assert.equal(dispatchCalls, 0);
  } finally {
    restore();
  }
});

test('cancelled queue logs no longer block a fresh manual queue on the same day', async () => {
  const cancelledLogs = [
    createLog('cancelled_same_day', {
      invoice_id: 'inv_1',
      status: 'cancelled',
      createdAt: new Date('2026-04-03T09:00:00.000Z'),
      target_email: 'responsavel@example.com',
      target_email_normalized: 'responsavel@example.com',
    }),
  ];
  const createdLogs = [];
  const config = createConfig();
  const invoice = {
    _id: 'inv_1',
    school_id: 'school_1',
    status: 'pending',
    dueDate: new Date('2026-04-10T00:00:00.000Z'),
    description: 'Mensalidade Abril',
    gateway: 'cora',
    boleto_url: 'https://example.com/boleto.pdf',
    boleto_digitable_line: '40390000074558869801469804521016114120000040000',
    external_id: 'charge_1',
    student: {
      _id: 'student_1',
      fullName: 'Aluno Teste',
      financialResp: 'TUTOR',
      tutors: [],
    },
    tutor: {
      _id: 'tutor_1',
      fullName: 'Responsável Teste',
      email: 'responsavel@example.com',
      phoneNumber: null,
    },
  };

  const restore = patchMethods([
    {
      target: NotificationLog,
      key: 'find',
      value: (filter = {}) => createQuery(cancelledLogs.filter((log) => matchFilter(log, filter))),
    },
    {
      target: NotificationConfig,
      key: 'findOne',
      value: () => createQuery(config),
    },
    {
      target: NotificationConfig,
      key: 'create',
      value: async () => config,
    },
    {
      target: Invoice,
      key: 'findById',
      value: () => createQuery(invoice),
    },
    {
      target: billingEligibilityService,
      key: 'isInvoiceOnHold',
      value: async () => ({ onHold: false, compensation: null }),
    },
    {
      target: billingEligibilityService,
      key: 'evaluateInvoice',
      value: async () => ({ isEligible: true, type: 'new_invoice', reason: 'ELIGIBLE', onHold: false }),
    },
    {
      target: notificationRecipientResolverService,
      key: 'resolveByInvoice',
      value: async () => createRecipient(),
    },
    {
      target: notificationChannelSelectorService,
      key: 'selectChannel',
      value: () => ({
        channel: 'email',
        provider: 'gmail',
        resolution_reason: 'primary_channel_available',
        target_email: 'responsavel@example.com',
        target_phone: null,
      }),
    },
    {
      target: notificationLogService,
      key: 'findLatestSuccessfulLogForInvoice',
      value: async () => null,
    },
    {
      target: notificationLogService,
      key: 'createLog',
      value: async (input) => {
        const log = createLog('new_queue_log', {
          invoice_id: input.invoiceId,
          status: input.status,
          delivery_channel: input.deliveryChannel,
          provider: input.provider,
          target_email: input.recipient.target_email,
          target_email_normalized: input.recipient.target_email,
          delivery_key: input.deliveryKey,
        });
        createdLogs.push(log);
        return deepClone(log);
      },
    },
  ]);

  const service = new NotificationService();
  service.dispatchService = {
    async assertReady() {
      return true;
    },
  };

  try {
    const result = await service.enqueueInvoiceManually({
      schoolId: 'school_1',
      invoice,
      type: 'manual',
    });

    assert.equal(result.status, 'queued');
    assert.equal(result.code, 'NOTIFICATION_QUEUED');
    assert.equal(createdLogs.length, 1);
    assert.equal(createdLogs[0].delivery_channel, 'email');
  } finally {
    restore();
  }
});
