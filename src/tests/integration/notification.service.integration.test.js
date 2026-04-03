const test = require('node:test');
const assert = require('node:assert/strict');

const NotificationLog = require('../../api/models/notification-log.model');
const NotificationTransportLog = require('../../api/models/notification_transport_log.model');
const WhatsappTransportLog = require('../../api/models/whatsapp_transport_log.model');
const NotificationConfig = require('../../api/models/notification-config.model');
const Invoice = require('../../api/models/invoice.model');
const School = require('../../api/models/school.model');
const notificationLogService = require('../../api/services/notificationLog.service');
const billingEligibilityService = require('../../api/services/billingEligibility.service');
const notificationRecipientResolverService = require('../../api/services/notificationRecipientResolver.service');
const notificationChannelSelectorService = require('../../api/services/notificationChannelSelector.service');
const billingMessageComposerService = require('../../api/services/billingMessageComposer.service');
const { NotificationService } = require('../../api/services/notification.service');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createQuery(data) {
  return {
    _data: data,
    _skip: 0,
    _limit: null,
    sort(sorter = {}) {
      if (Array.isArray(this._data)) {
        const [[field, direction]] = Object.entries(sorter);
        this._data = [...this._data].sort((left, right) => {
          const leftValue = new Date(left[field] || 0).getTime();
          const rightValue = new Date(right[field] || 0).getTime();
          return direction < 0 ? rightValue - leftValue : leftValue - rightValue;
        });
      }
      return this;
    },
    select() { return this; },
    skip(value) { this._skip = value; return this; },
    limit(value) { this._limit = value; return this; },
    populate() { return this; },
    lean() {
      if (!Array.isArray(this._data)) return Promise.resolve(deepClone(this._data));
      const sliced = this._data.slice(this._skip, this._limit ? this._skip + this._limit : undefined);
      return Promise.resolve(deepClone(sliced));
    },
    then(resolve, reject) {
      return this.lean().then(resolve, reject);
    },
  };
}

function matchFilter(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or' && Array.isArray(value)) {
      return value.some((item) => matchFilter(doc, item));
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('$gte' in value || '$lte' in value) {
        const docValue = new Date(doc[key]).getTime();
        const gte = value.$gte ? new Date(value.$gte).getTime() : Number.MIN_SAFE_INTEGER;
        const lte = value.$lte ? new Date(value.$lte).getTime() : Number.MAX_SAFE_INTEGER;
        return docValue >= gte && docValue <= lte;
      }

      if ('$in' in value) {
        return value.$in.map(String).includes(String(doc[key]));
      }
    }

    return String(doc[key]) === String(value);
  });
}

function createHarness() {
  const now = new Date('2026-04-02T12:00:00.000Z');
  let logCounter = 1;
  const logs = [];
  const transportLogs = [];

  const config = {
    _id: 'config_1',
    school_id: 'school_1',
    isActive: true,
    windowStart: '08:00',
    windowEnd: '18:00',
    enableReminder: true,
    enableNewInvoice: true,
    enableDueToday: true,
    enableOverdue: true,
    primaryChannel: 'whatsapp',
    allowFallback: false,
    channels: {
      whatsapp: { enabled: true, provider: 'evolution', sendPdfWhenAvailable: true },
      email: { enabled: false, provider: 'gmail' },
    },
    toObject() {
      return deepClone(this);
    },
  };

  const invoice = {
    _id: 'inv_1',
    school_id: 'school_1',
    student: { _id: 'student_1', fullName: 'Aluno Teste' },
    tutor: { _id: 'tutor_1', fullName: 'Tutor Teste' },
    description: 'Mensalidade Abril',
    value: 15000,
    dueDate: new Date('2026-04-10T00:00:00.000Z'),
    status: 'pending',
    gateway: 'cora',
    boleto_url: 'https://example.com/boleto.pdf',
    boleto_barcode: '23793381286008200009012000004702975870000002000',
    pix_code: null,
    external_id: 'charge_1',
  };

  const school = {
    _id: 'school_1',
    name: 'Academy Hub',
    whatsapp: { status: 'connected' },
  };

  return {
    now,
    logs,
    transportLogs,
    config,
    invoice,
    school,
    buildLog(patch = {}) {
      return {
        _id: `log_${logCounter++}`,
        school_id: 'school_1',
        invoice_id: 'inv_1',
        student_name: 'Aluno Teste',
        tutor_name: 'Tutor Teste',
        target_phone: '5511999999999',
        target_phone_normalized: '5511999999999',
        target_email: null,
        target_email_normalized: null,
        recipient_role: 'tutor',
        recipient_name: 'Tutor Teste',
        recipient_snapshot: {
          role: 'tutor',
          student_id: 'student_1',
          tutor_id: 'tutor_1',
          name: 'Tutor Teste',
          first_name: 'Tutor',
          phone: '5511999999999',
          phone_normalized: '5511999999999',
          email: null,
          email_normalized: null,
        },
        delivery_channel: 'whatsapp',
        provider: 'evolution',
        type: 'new_invoice',
        status: 'queued',
        scheduled_for: now,
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        ...patch,
      };
    },
  };
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

test('NotificationService enqueue/processQueue and compatibility methods work with multichannel base', async () => {
  const h = createHarness();

  const restore = patchMethods([
    {
      target: notificationLogService,
      key: 'findExistingLogForDay',
      value: async () => ({
        existing: null,
        deliveryKey: 'delivery_key_1',
        businessDay: '2026-04-02',
        businessTimeZone: 'America/Sao_Paulo',
      }),
    },
    {
      target: notificationLogService,
      key: 'createLog',
      value: async (input) => {
        const log = h.buildLog({
          invoice_id: input.invoiceId,
          delivery_channel: input.deliveryChannel,
          provider: input.provider,
          type: input.type,
          dispatch_origin: input.dispatchOrigin,
          delivery_key: input.deliveryKey,
          recipient_role: input.recipient.recipient_role,
          recipient_name: input.recipient.recipient_name,
          recipient_snapshot: input.recipient.recipient_snapshot,
          target_phone: input.recipient.target_phone,
          target_phone_normalized: input.recipient.target_phone,
          target_email: input.recipient.target_email || null,
          target_email_normalized: input.recipient.target_email || null,
        });
        h.logs.push(log);
        return deepClone(log);
      },
    },
    {
      target: notificationLogService,
      key: 'updateLogById',
      value: async (logId, patch) => {
        const log = h.logs.find((item) => item._id === logId);
        Object.assign(log, patch, { updatedAt: h.now });
        return deepClone(log);
      },
    },
    {
      target: notificationLogService,
      key: 'markQueued',
      value: async (logId, { scheduledFor = h.now } = {}) => {
        const log = h.logs.find((item) => item._id === logId);
        Object.assign(log, { status: 'queued', scheduled_for: scheduledFor, updatedAt: h.now });
        return deepClone(log);
      },
    },
    {
      target: notificationLogService,
      key: 'markSent',
      value: async (logId, { sentAt = h.now, transportLog = null } = {}) => {
        const log = h.logs.find((item) => item._id === logId);
        Object.assign(log, {
          status: 'sent',
          sent_at: sentAt,
          last_transport_log_id: transportLog?._id || null,
          last_transport_status: transportLog?.status || null,
          last_transport_canonical_status: transportLog?.canonical_status || null,
          attempts: transportLog?.attempt_number || log.attempts || 0,
          updatedAt: h.now,
        });
        return deepClone(log);
      },
    },
    {
      target: notificationLogService,
      key: 'markFailed',
      value: async (logId, { errorMessage, errorCode } = {}) => {
        const log = h.logs.find((item) => item._id === logId);
        Object.assign(log, {
          status: 'failed',
          error_message: errorMessage,
          error_code: errorCode,
          updatedAt: h.now,
        });
        return deepClone(log);
      },
    },
    {
      target: notificationLogService,
      key: 'markCancelled',
      value: async (logId, { errorMessage, errorCode } = {}) => {
        const log = h.logs.find((item) => item._id === logId);
        Object.assign(log, {
          status: 'cancelled',
          error_message: errorMessage,
          error_code: errorCode,
          updatedAt: h.now,
        });
        return deepClone(log);
      },
    },
    {
      target: notificationLogService,
      key: 'resolveRecipient',
      value: (log) => ({
        recipient_role: log.recipient_role || 'unknown',
        recipient_student_id: log.recipient_snapshot?.student_id || null,
        recipient_tutor_id: log.recipient_snapshot?.tutor_id || null,
        recipient_name: log.recipient_name || log.tutor_name || log.student_name,
        student_name: log.student_name,
        tutor_name: log.tutor_name,
        target_phone: log.target_phone,
        target_phone_normalized: log.target_phone_normalized,
        target_email: log.target_email,
        target_email_normalized: log.target_email_normalized,
        recipient_snapshot: log.recipient_snapshot,
      }),
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
      value: async () => ({
        recipient_role: 'tutor',
        recipient_student_id: 'student_1',
        recipient_tutor_id: 'tutor_1',
        recipient_name: 'Tutor Teste',
        student_name: 'Aluno Teste',
        tutor_name: 'Tutor Teste',
        target_phone: '5511999999999',
        target_phone_normalized: '5511999999999',
        target_email: null,
        target_email_normalized: null,
        recipient_snapshot: {
          role: 'tutor',
          student_id: 'student_1',
          tutor_id: 'tutor_1',
          name: 'Tutor Teste',
          first_name: 'Tutor',
          phone: '5511999999999',
          phone_normalized: '5511999999999',
          email: null,
          email_normalized: null,
        },
      }),
    },
    {
      target: notificationChannelSelectorService,
      key: 'selectChannel',
      value: () => ({
        channel: 'whatsapp',
        provider: 'evolution',
        resolution_reason: 'primary_channel_available',
        target_phone: '5511999999999',
        target_email: null,
      }),
    },
    {
      target: billingMessageComposerService,
      key: 'compose',
      value: () => ({
        template_group: 'FUTURO',
        template_index: 0,
        subject: 'Academy Hub | Mensalidade Abril',
        text: 'Mensagem de cobranca',
        html: '<p>Mensagem de cobranca</p>',
        attachmentsPlan: [],
        message_preview: 'Mensagem de cobranca',
        payment_link: 'https://example.com/boleto.pdf',
        barcode: '23793381286008200009012000004702975870000002000',
        transportHints: { whatsapp: { shouldTryFile: false }, email: { attachBoletoPdf: false } },
      }),
    },
    {
      target: NotificationLog,
      key: 'find',
      value: (filter = {}) => createQuery(h.logs.filter((log) => matchFilter(log, filter))),
    },
    {
      target: NotificationLog,
      key: 'findOne',
      value: (filter = {}) => createQuery(h.logs.find((log) => matchFilter(log, filter)) || null),
    },
    {
      target: NotificationLog,
      key: 'findOneAndUpdate',
      value: async (filter, update) => {
        const log = h.logs.find((item) => item._id === filter._id && item.status === filter.status);
        if (!log) return null;
        Object.assign(log, update.$set || {}, { updatedAt: h.now });
        return deepClone(log);
      },
    },
    {
      target: NotificationLog,
      key: 'countDocuments',
      value: async (filter = {}) => h.logs.filter((log) => matchFilter(log, filter)).length,
    },
    {
      target: NotificationLog,
      key: 'findById',
      value: async (id) => deepClone(h.logs.find((log) => log._id === id) || null),
    },
    {
      target: NotificationTransportLog,
      key: 'findOne',
      value: () => createQuery(null),
    },
    {
      target: NotificationTransportLog,
      key: 'find',
      value: (filter = {}) => createQuery(h.transportLogs.filter((log) => matchFilter(log, filter))),
    },
    {
      target: WhatsappTransportLog,
      key: 'findOne',
      value: () => createQuery(null),
    },
    {
      target: WhatsappTransportLog,
      key: 'find',
      value: () => createQuery([]),
    },
    {
      target: NotificationConfig,
      key: 'find',
      value: (filter = {}) => createQuery(matchFilter(h.config, filter) ? [h.config] : []),
    },
    {
      target: NotificationConfig,
      key: 'findOne',
      value: (filter = {}) => createQuery(matchFilter(h.config, filter) ? h.config : null),
    },
    {
      target: NotificationConfig,
      key: 'create',
      value: async (input) => ({
        ...deepClone(h.config),
        ...input,
        toObject() { return deepClone({ ...h.config, ...input }); },
      }),
    },
    {
      target: NotificationConfig,
      key: 'findOneAndUpdate',
      value: async (_filter, payload) => {
        Object.assign(h.config, payload);
        return {
          ...deepClone(h.config),
          toObject() { return deepClone(h.config); },
        };
      },
    },
    {
      target: Invoice,
      key: 'findById',
      value: () => createQuery(h.invoice),
    },
    {
      target: Invoice,
      key: 'find',
      value: () => createQuery([h.invoice]),
    },
    {
      target: School,
      key: 'findById',
      value: () => createQuery(h.school),
    },
  ]);

  const service = new NotificationService();
  service.delayMinMs = 0;
  service.delayMaxMs = 0;
  service.dispatchService = {
    async assertReady() {
      return true;
    },
    async dispatch({ notificationLog }) {
      const attempt = {
        _id: 'attempt_1',
        attempt_number: 1,
        status: 'accepted',
        canonical_status: 'accepted',
        accepted_at: h.now,
      };
      h.transportLogs.push({
        _id: 'attempt_1',
        school_id: notificationLog.school_id,
        notification_log_id: notificationLog._id,
        invoice_id: notificationLog.invoice_id,
        channel: notificationLog.delivery_channel,
        provider: notificationLog.provider,
        status: 'accepted',
        canonical_status: 'accepted',
        destination: notificationLog.target_phone,
        last_event_at: h.now,
        createdAt: h.now,
      });
      return { attempt };
    },
  };

  try {
    const enqueueResult = await service.enqueueInvoiceManually({
      schoolId: 'school_1',
      invoice: h.invoice,
      type: 'manual',
    });

    assert.equal(enqueueResult.success, true);
    assert.equal(enqueueResult.status, 'queued');
    assert.equal(enqueueResult.code, 'NOTIFICATION_QUEUED');
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].delivery_channel, 'whatsapp');
    assert.equal(h.logs[0].recipient_snapshot.role, 'tutor');

    await service.processQueue({ schoolId: 'school_1' });

    assert.equal(h.logs[0].status, 'sent');
    assert.equal(h.logs[0].last_transport_canonical_status, 'accepted');

    const logsResponse = await service.getLogs('school_1', null, 1, 20, '2026-04-02');
    assert.equal(logsResponse.total, 1);
    assert.equal(logsResponse.logs[0].target_phone, '5511999999999');
    assert.equal(logsResponse.logs[0].recipient_role, 'tutor');

    const stats = await service.getDailyStats('school_1', '2026-04-02');
    assert.equal(stats.sent, 1);
    assert.equal(stats.by_channel.whatsapp, 1);

    const forecast = await service.getForecast('school_1', '2026-04-02');
    assert.equal(forecast.breakdown.new_invoice, 1);
    assert.equal(forecast.primary_channel_preview, 'whatsapp');

    const transportLogs = await service.getTransportLogs('school_1', { page: 1, limit: 20 });
    assert.equal(transportLogs.total, 1);
    assert.equal(transportLogs.logs[0].canonical_status, 'accepted');
  } finally {
    restore();
  }
});
