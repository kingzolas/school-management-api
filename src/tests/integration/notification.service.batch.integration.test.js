const test = require('node:test');
const assert = require('node:assert/strict');

const NotificationLog = require('../../api/models/notification-log.model');
const NotificationConfig = require('../../api/models/notification-config.model');
const Invoice = require('../../api/models/invoice.model');
const School = require('../../api/models/school.model');
const notificationLogService = require('../../api/services/notificationLog.service');
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

function createConfig(overrides = {}) {
  return {
    _id: 'config_1',
    school_id: 'school_1',
    isActive: true,
    windowStart: '08:00',
    windowEnd: '18:00',
    enableReminder: true,
    enableNewInvoice: true,
    enableDueToday: true,
    enableOverdue: true,
    primaryChannel: 'email',
    allowFallback: false,
    channels: {
      whatsapp: { enabled: true, provider: 'evolution', sendPdfWhenAvailable: true },
      email: { enabled: true, provider: 'gmail', attachBoletoPdf: false },
    },
    toObject() {
      return deepClone(this);
    },
    ...overrides,
  };
}

function createInvoice({
  id,
  status = 'pending',
  email = 'responsavel@example.com',
  description = 'Mensalidade Abril',
  boletoUrl = 'https://example.com/boleto.pdf',
  dueDate = new Date(2026, 3, 10, 12, 0, 0),
} = {}) {
  return {
    _id: id,
    school_id: 'school_1',
    status,
    description,
    value: 40000,
    dueDate: dueDate instanceof Date ? dueDate : new Date(dueDate),
    gateway: 'cora',
    boleto_url: boletoUrl,
    boleto_digitable_line: '40390000074558869801469804521016114120000040000',
    external_id: `charge_${id}`,
    student: {
      _id: `student_${id}`,
      fullName: `Aluno ${id}`,
      financialResp: 'TUTOR',
      tutors: [],
    },
    tutor: {
      _id: `tutor_${id}`,
      fullName: `Responsavel ${id}`,
      email,
      phoneNumber: '(11) 99999-9999',
    },
  };
}

test('queueMonthInvoicesManually returns queued/skipped breakdown for mixed invoices and never queues paid invoices', async () => {
  const logs = [];
  let logCounter = 1;
  const invoices = [
    createInvoice({ id: 'valid' }),
    createInvoice({ id: 'paid', status: 'paid' }),
    createInvoice({ id: 'missing_email', email: null }),
    createInvoice({ id: 'invalid_email', email: 'email-invalido' }),
    createInvoice({ id: 'cancelled', status: 'canceled' }),
  ];
  const config = createConfig();

  const restore = patchMethods([
    {
      target: notificationLogService,
      key: 'findExistingOutcomeLogForDay',
      value: async () => ({
        existing: null,
        businessDay: '2026-04-03',
        businessTimeZone: 'America/Sao_Paulo',
      }),
    },
    {
      target: notificationLogService,
      key: 'findExistingLogForDay',
      value: async () => ({
        existing: null,
        deliveryKey: `delivery_${Date.now()}`,
        businessDay: '2026-04-03',
        businessTimeZone: 'America/Sao_Paulo',
      }),
    },
    {
      target: notificationLogService,
      key: 'createLog',
      value: async (input) => {
        const log = {
            _id: `log_${logCounter++}`,
            school_id: input.schoolId,
            invoice_id: input.invoiceId,
            delivery_channel: input.deliveryChannel,
            provider: input.provider,
            status: input.status,
            type: input.type,
          student_name: input.recipient.student_name,
          tutor_name: input.recipient.tutor_name,
          recipient_name: input.recipient.recipient_name,
          recipient_role: input.recipient.recipient_role,
          recipient_snapshot: input.recipient.recipient_snapshot,
          target_email: input.recipient.target_email,
          target_email_normalized: input.recipient.target_email,
          outcome_code: input.outcome_code || null,
          outcome_user_message: input.message_preview || null,
          skipped_at: input.skipped_at || null,
          createdAt: new Date('2026-04-03T12:00:00.000Z'),
          updatedAt: new Date('2026-04-03T12:00:00.000Z'),
        };
        logs.push(log);
        return deepClone(log);
      },
    },
    {
      target: billingEligibilityService,
      key: 'isInvoiceOnHold',
      value: async (invoice) => ({ onHold: invoice.hold === true, compensation: null }),
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
      key: 'find',
      value: () => createQuery(invoices),
    },
    {
      target: Invoice,
      key: 'findOne',
      value: () => createQuery({ updatedAt: new Date('2026-04-03T11:00:00.000Z') }),
    },
  ]);

  const service = new NotificationService();
  service.dispatchService = {
    async assertReady() {
      return true;
    },
  };

  try {
    const result = await service.queueMonthInvoicesManually('school_1');

    assert.equal(result.total_analisado, 5);
    assert.equal(result.total_elegivel, 1);
    assert.equal(result.total_queued, 1);
    assert.equal(result.total_skipped, 4);
    assert.equal(result.total_failed, 0);
    assert.equal(result.breakdown.NOTIFICATION_QUEUED, 1);
    assert.equal(result.breakdown.INVOICE_ALREADY_PAID, 1);
    assert.equal(result.breakdown.RECIPIENT_EMAIL_MISSING, 1);
    assert.equal(result.breakdown.RECIPIENT_EMAIL_INVALID, 1);
    assert.equal(result.breakdown.INVOICE_CANCELLED, 1);
    assert.equal(logs.length, 5);
    assert.equal(String(logs.find((item) => item.status === 'queued').invoice_id), 'valid');
    assert.equal(logs.filter((item) => item.status === 'skipped').length, 4);
    assert.equal(logs.find((item) => item.outcome_code === 'INVOICE_ALREADY_PAID').status, 'skipped');
    assert.equal(logs.find((item) => item.outcome_code === 'RECIPIENT_EMAIL_MISSING').status, 'skipped');
    assert.equal(logs.find((item) => item.outcome_code === 'RECIPIENT_EMAIL_INVALID').status, 'skipped');
    assert.equal(logs.find((item) => item.outcome_code === 'INVOICE_CANCELLED').status, 'skipped');
  } finally {
    restore();
  }
});

test('enqueueInvoiceManually returns retryable failed outcome when provider has temporary error', async () => {
  const logs = [];
  const invoice = createInvoice({ id: 'temp_fail' });
  const config = createConfig();

  const restore = patchMethods([
    {
      target: notificationLogService,
      key: 'findExistingOutcomeLogForDay',
      value: async () => ({
        existing: null,
        businessDay: '2026-04-03',
        businessTimeZone: 'America/Sao_Paulo',
      }),
    },
    {
      target: notificationLogService,
      key: 'findExistingLogForDay',
      value: async () => ({
        existing: null,
        deliveryKey: 'delivery_key_temp_fail',
        businessDay: '2026-04-03',
        businessTimeZone: 'America/Sao_Paulo',
      }),
    },
    {
      target: notificationLogService,
      key: 'createLog',
      value: async (input) => {
        const log = {
            _id: 'log_temp_fail',
            school_id: input.schoolId,
            invoice_id: input.invoiceId,
            delivery_channel: input.deliveryChannel,
            provider: input.provider,
            status: input.status,
            type: input.type,
          student_name: input.recipient.student_name,
          tutor_name: input.recipient.tutor_name,
          recipient_name: input.recipient.recipient_name,
          recipient_role: input.recipient.recipient_role,
          recipient_snapshot: input.recipient.recipient_snapshot,
          target_email: input.recipient.target_email,
          target_email_normalized: input.recipient.target_email,
          createdAt: new Date('2026-04-03T12:00:00.000Z'),
          updatedAt: new Date('2026-04-03T12:00:00.000Z'),
        };
        logs.push(log);
        return deepClone(log);
      },
    },
    {
      target: notificationLogService,
      key: 'updateLogById',
      value: async (logId, patch) => {
        const log = logs.find((item) => item._id === logId);
        Object.assign(log, patch, { updatedAt: new Date('2026-04-03T12:01:00.000Z') });
        return deepClone(log);
      },
    },
    {
      target: notificationLogService,
      key: 'markFailed',
      value: async (logId, patch) => {
        const log = logs.find((item) => item._id === logId);
        Object.assign(log, {
          status: 'failed',
          error_code: patch.errorCode,
          error_message: patch.errorMessage,
          error_http_status: patch.errorHttpStatus,
        });
        return deepClone(log);
      },
    },
    {
      target: billingEligibilityService,
      key: 'isInvoiceOnHold',
      value: async () => ({ onHold: false, compensation: null }),
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
      target: NotificationLog,
      key: 'findOneAndUpdate',
      value: async (filter, update) => {
        const log = logs.find((item) => item._id === filter._id && item.status === filter.status);
        if (!log) return null;
        Object.assign(log, update.$set || {});
        return deepClone(log);
      },
    },
    {
      target: NotificationLog,
      key: 'findById',
      value: async (id) => deepClone(logs.find((item) => item._id === id) || null),
    },
    {
      target: School,
      key: 'findById',
      value: () => createQuery({ _id: 'school_1', name: 'Escola Teste', whatsapp: { status: 'connected' } }),
    },
    {
      target: Invoice,
      key: 'findById',
      value: () => createQuery(invoice),
    },
  ]);

  const service = new NotificationService();
  service.dispatchService = {
    async assertReady() {
      return true;
    },
    async dispatch() {
      const error = new Error('Provider temporariamente indisponivel');
      error.status = 503;
      error.response = {
        status: 503,
        data: { message: 'temporario' },
      };
      throw error;
    },
  };

  try {
    const result = await service.enqueueInvoiceManually({
      schoolId: 'school_1',
      invoice,
      type: 'manual',
      force: true,
      processNow: true,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'PROVIDER_TEMPORARY_FAILURE');
    assert.equal(result.retryable, true);
    assert.equal(logs[0].status, 'failed');
    assert.equal(logs[0].error_code, 'PROVIDER_TEMPORARY_FAILURE');
  } finally {
    restore();
  }
});

test('enqueueInvoiceManually skips when email channel is disabled or invoice is already paid', async () => {
  const logs = [];
  const disabledConfig = createConfig({
    channels: {
      whatsapp: { enabled: true, provider: 'evolution', sendPdfWhenAvailable: true },
      email: { enabled: false, provider: 'gmail', attachBoletoPdf: false },
    },
  });
  const pendingInvoice = createInvoice({ id: 'channel_disabled' });
  const paidInvoice = createInvoice({ id: 'paid_manual', status: 'paid' });

  const restore = patchMethods([
    {
      target: notificationLogService,
      key: 'findExistingOutcomeLogForDay',
      value: async () => ({
        existing: null,
        businessDay: '2026-04-03',
        businessTimeZone: 'America/Sao_Paulo',
      }),
    },
    {
      target: notificationLogService,
      key: 'createLog',
      value: async (input) => {
        const log = {
          _id: `log_${logs.length + 1}`,
          school_id: input.schoolId,
          invoice_id: input.invoiceId,
          status: input.status,
          delivery_channel: input.deliveryChannel,
          provider: input.provider,
          outcome_code: input.outcome_code || null,
          outcome_user_message: input.message_preview || null,
          skipped_at: input.skipped_at || null,
          createdAt: new Date('2026-04-03T12:00:00.000Z'),
        };
        logs.push(log);
        return deepClone(log);
      },
    },
    {
      target: billingEligibilityService,
      key: 'isInvoiceOnHold',
      value: async () => ({ onHold: false, compensation: null }),
    },
    {
      target: NotificationConfig,
      key: 'findOne',
      value: () => createQuery(disabledConfig),
    },
    {
      target: NotificationConfig,
      key: 'create',
      value: async () => disabledConfig,
    },
  ]);

  const service = new NotificationService();
  service.dispatchService = {
    async assertReady() {
      return true;
    },
  };

  try {
    const disabledResult = await service.enqueueInvoiceManually({
      schoolId: 'school_1',
      invoice: pendingInvoice,
      processNow: false,
    });

    const paidResult = await service.enqueueInvoiceManually({
      schoolId: 'school_1',
      invoice: paidInvoice,
      processNow: false,
    });

    assert.equal(disabledResult.status, 'skipped');
    assert.equal(disabledResult.code, 'EMAIL_CHANNEL_DISABLED');
    assert.equal(disabledResult.success, true);
    assert.equal(paidResult.status, 'skipped');
    assert.equal(paidResult.code, 'INVOICE_ALREADY_PAID');
    assert.equal(paidResult.success, true);
    assert.equal(logs.length, 2);
    assert.equal(logs.find((item) => item.outcome_code === 'EMAIL_CHANNEL_DISABLED').status, 'skipped');
    assert.equal(logs.find((item) => item.outcome_code === 'INVOICE_ALREADY_PAID').status, 'skipped');
  } finally {
    restore();
  }
});

test('queueMonthInvoicesManually creates auditable skipped log for hold active invoice', async () => {
  const logs = [];
  const holdInvoice = {
    ...createInvoice({ id: 'hold_invoice' }),
    hold: true,
  };
  const config = createConfig();

  const restore = patchMethods([
    {
      target: notificationLogService,
      key: 'findExistingOutcomeLogForDay',
      value: async () => ({
        existing: null,
        businessDay: '2026-04-03',
        businessTimeZone: 'America/Sao_Paulo',
      }),
    },
    {
      target: notificationLogService,
      key: 'createLog',
      value: async (input) => {
        const log = {
          _id: 'log_hold',
          school_id: input.schoolId,
          invoice_id: input.invoiceId,
          status: input.status,
          delivery_channel: input.deliveryChannel,
          provider: input.provider,
          recipient_name: input.recipient.recipient_name,
          target_email: input.recipient.target_email,
          outcome_code: input.outcome_code || null,
          outcome_user_message: input.message_preview || null,
          skipped_at: input.skipped_at || null,
          createdAt: new Date('2026-04-03T12:00:00.000Z'),
        };
        logs.push(log);
        return deepClone(log);
      },
    },
    {
      target: billingEligibilityService,
      key: 'isInvoiceOnHold',
      value: async (invoice) => ({ onHold: invoice.hold === true, compensation: invoice.hold ? { _id: 'comp_1' } : null }),
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
      key: 'find',
      value: () => createQuery([holdInvoice]),
    },
  ]);

  const service = new NotificationService();
  service.dispatchService = {
    async assertReady() {
      return true;
    },
  };

  try {
    const result = await service.queueMonthInvoicesManually('school_1');

    assert.equal(result.total_queued, 0);
    assert.equal(result.total_skipped, 1);
    assert.equal(result.breakdown.HOLD_ACTIVE, 1);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'skipped');
    assert.equal(logs[0].outcome_code, 'HOLD_ACTIVE');
  } finally {
    restore();
  }
});

test('getForecast is channel-aware for email and excludes invoices without valid destination', async () => {
  const invoices = [
    createInvoice({ id: 'forecast_valid' }),
    createInvoice({ id: 'forecast_missing', email: null }),
    createInvoice({ id: 'forecast_invalid', email: 'email-invalido' }),
  ];
  const config = createConfig();

  const restore = patchMethods([
    {
      target: billingEligibilityService,
      key: 'isInvoiceOnHold',
      value: async () => ({ onHold: false, compensation: null }),
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
      key: 'find',
      value: () => createQuery(invoices),
    },
    {
      target: Invoice,
      key: 'findOne',
      value: () => createQuery({ updatedAt: new Date('2026-04-03T11:00:00.000Z') }),
    },
  ]);

  const service = new NotificationService();
  service.dispatchService = {
    async assertReady() {
      return true;
    },
  };

  try {
    const forecast = await service.getForecast('school_1', '2026-04-07');

    assert.equal(forecast.total_expected, 1);
    assert.equal(forecast.breakdown.reminder, 1);
    assert.equal(forecast.skipped_breakdown.RECIPIENT_EMAIL_MISSING, 1);
    assert.equal(forecast.skipped_breakdown.RECIPIENT_EMAIL_INVALID, 1);
  } finally {
    restore();
  }
});

test('getLogs and getDailyStats expose skipped records with operational visibility', async () => {
  const skippedLog = {
    _id: 'log_skipped_1',
    school_id: 'school_1',
    invoice_id: 'inv_skipped_1',
    status: 'skipped',
    delivery_channel: 'email',
    provider: 'gmail',
    createdAt: new Date('2026-04-03T12:00:00.000Z'),
    updatedAt: new Date('2026-04-03T12:00:00.000Z'),
    recipient_role: 'tutor',
    recipient_name: 'Responsavel Sem Email',
    recipient_snapshot: {
      role: 'tutor',
      student_id: 'student_skipped_1',
      tutor_id: 'tutor_skipped_1',
      name: 'Responsavel Sem Email',
      first_name: 'Responsavel',
      phone: null,
      phone_normalized: null,
      email: null,
      email_normalized: null,
    },
    student_name: 'Aluno Skipped',
    tutor_name: 'Responsavel Sem Email',
    target_email: null,
    target_email_normalized: null,
    outcome_code: 'RECIPIENT_EMAIL_MISSING',
    outcome_category: 'recipient_error',
    outcome_title: 'Responsável sem e-mail',
    outcome_user_message: 'O responsável financeiro não possui e-mail cadastrado para receber a cobrança.',
    outcome_retryable: false,
    dispatch_origin: 'manual_month',
  };

  const restore = patchMethods([
    {
      target: NotificationLog,
      key: 'find',
      value: () => createQuery([skippedLog]),
    },
    {
      target: NotificationLog,
      key: 'countDocuments',
      value: async () => 1,
    },
  ]);

  const service = new NotificationService();

  try {
    const logsResult = await service.getLogs('school_1', 'skipped', 1, 20, '2026-04-03');
    const statsResult = await service.getDailyStats('school_1', '2026-04-03');

    assert.equal(logsResult.total, 1);
    assert.equal(logsResult.logs[0].status, 'skipped');
    assert.equal(logsResult.logs[0].reason_code, 'RECIPIENT_EMAIL_MISSING');
    assert.equal(logsResult.logs[0].user_message, 'O responsável financeiro não possui e-mail cadastrado para receber a cobrança.');
    assert.equal(statsResult.skipped, 1);
    assert.equal(statsResult.by_channel.email, 1);
    assert.equal(statsResult.by_channel_status.email.skipped, 1);
  } finally {
    restore();
  }
});

test('getLogs and getDailyStats separate current queue from selected-day history', async () => {
  const queuedOldLog = {
    _id: 'log_queue_old',
    school_id: 'school_1',
    invoice_id: 'inv_queue_old',
    status: 'queued',
    delivery_channel: 'email',
    provider: 'gmail',
    createdAt: new Date('2026-04-02T12:00:00.000Z'),
    updatedAt: new Date('2026-04-03T13:00:00.000Z'),
    scheduled_for: new Date('2026-04-03T13:00:00.000Z'),
    recipient_role: 'tutor',
    recipient_name: 'Responsavel Queue',
    student_name: 'Aluno Queue',
    tutor_name: 'Responsavel Queue',
    target_email: 'queue@example.com',
    target_email_normalized: 'queue@example.com',
  };

  const sentTodayLog = {
    _id: 'log_sent_today',
    school_id: 'school_1',
    invoice_id: 'inv_sent_today',
    status: 'sent',
    delivery_channel: 'email',
    provider: 'gmail',
    createdAt: new Date('2026-04-03T12:00:00.000Z'),
    updatedAt: new Date('2026-04-03T12:05:00.000Z'),
    recipient_role: 'tutor',
    recipient_name: 'Responsavel Sent',
    student_name: 'Aluno Sent',
    tutor_name: 'Responsavel Sent',
    target_email: 'sent@example.com',
    target_email_normalized: 'sent@example.com',
  };

  const restore = patchMethods([
    {
      target: NotificationLog,
      key: 'find',
      value: (filter = {}) => {
        if (filter?.status?.$in) {
          return createQuery([queuedOldLog]);
        }

        if (filter?.status === 'queued' && !filter?.createdAt) {
          return createQuery([queuedOldLog]);
        }

        if (filter?.createdAt) {
          return createQuery([sentTodayLog]);
        }

        return createQuery([]);
      },
    },
    {
      target: NotificationLog,
      key: 'countDocuments',
      value: async (filter = {}) => {
        if (filter?.status === 'queued' && !filter?.createdAt) return 1;
        if (filter?.createdAt) return 1;
        return 0;
      },
    },
  ]);

  const service = new NotificationService();

  try {
    const queueLogs = await service.getLogs('school_1', 'queued', 1, 20, '2026-04-03');
    const stats = await service.getDailyStats('school_1', '2026-04-03');

    assert.equal(queueLogs.scope, 'operational');
    assert.equal(queueLogs.total, 1);
    assert.equal(queueLogs.logs[0].invoice_id, 'inv_queue_old');

    assert.equal(stats.queued, 1);
    assert.equal(stats.processing, 0);
    assert.equal(stats.queued_today, 0);
    assert.equal(stats.processing_today, 0);
    assert.equal(stats.sent, 1);
    assert.equal(stats.total_today, 1);
    assert.equal(stats.queue_scope, 'current');
    assert.equal(stats.history_scope, 'selected_day');
  } finally {
    restore();
  }
});

test('getForecast caches the heavy simulation and invalidates explicitly', async () => {
  const invoices = [createInvoice({ id: 'forecast_cache_valid' })];
  const config = createConfig({
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  });
  let forecastQueryCount = 0;

  const restore = patchMethods([
    {
      target: billingEligibilityService,
      key: 'isInvoiceOnHold',
      value: async () => ({ onHold: false, compensation: null }),
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
      key: 'find',
      value: () => {
        forecastQueryCount += 1;
        return createQuery(invoices);
      },
    },
    {
      target: Invoice,
      key: 'findOne',
      value: () => createQuery({ updatedAt: new Date('2026-04-03T11:00:00.000Z') }),
    },
  ]);

  const service = new NotificationService();
  service.forecastCacheTtlMs = 60000;

  try {
    const first = await service.getForecast('school_1', '2026-04-07');
    const second = await service.getForecast('school_1', '2026-04-07');
    service.invalidateForecastCache({ schoolId: 'school_1' });
    const third = await service.getForecast('school_1', '2026-04-07');

    assert.equal(first.cache_hit, false);
    assert.equal(second.cache_hit, true);
    assert.equal(third.cache_hit, false);
    assert.equal(forecastQueryCount, 2);
  } finally {
    restore();
  }
});
