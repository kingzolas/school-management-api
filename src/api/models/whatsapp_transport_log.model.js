const mongoose = require('mongoose');

const STATUS_RANK = Object.freeze({
  queued: 10,
  accepted_by_evolution: 20,
  server_ack: 30,
  delivered: 40,
  read: 50,
  failed: 80,
  deleted: 90,
});

const StatusHistorySchema = new mongoose.Schema(
  {
    event_type: { type: String, default: null },
    canonical_status: {
      type: String,
      enum: Object.keys(STATUS_RANK),
      default: null,
    },
    provider_status: { type: String, default: null },
    occurred_at: { type: Date, default: null },
    raw_payload: { type: mongoose.Schema.Types.Mixed, default: null },
    source: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    error_message: { type: String, default: null },
    error_code: { type: String, default: null },
    error_http_status: { type: Number, default: null },
  },
  { _id: false }
);

const WhatsappTransportLogSchema = new mongoose.Schema(
  {
    school_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    instance_name: {
      type: String,
      required: true,
      index: true,
    },
    instance_id: {
      type: String,
      default: null,
      index: true,
    },
    provider_message_id: {
      type: String,
      default: null,
      index: true,
    },
    remote_jid: {
      type: String,
      default: null,
      index: true,
    },
    destination: {
      type: String,
      default: null,
      index: true,
    },
    source: {
      type: String,
      default: 'unknown',
      index: true,
    },
    status: {
      type: String,
      enum: Object.keys(STATUS_RANK),
      default: 'queued',
      index: true,
    },
    status_rank: {
      type: Number,
      default: STATUS_RANK.queued,
      index: true,
    },
    provider_status: {
      type: String,
      default: null,
      index: true,
    },
    provider_message_timestamp: {
      type: Date,
      default: null,
    },
    queued_at: {
      type: Date,
      default: null,
      index: true,
    },
    accepted_at: {
      type: Date,
      default: null,
      index: true,
    },
    server_ack_at: {
      type: Date,
      default: null,
      index: true,
    },
    delivered_at: {
      type: Date,
      default: null,
      index: true,
    },
    read_at: {
      type: Date,
      default: null,
      index: true,
    },
    failed_at: {
      type: Date,
      default: null,
      index: true,
    },
    deleted_at: {
      type: Date,
      default: null,
      index: true,
    },
    last_event_at: {
      type: Date,
      default: null,
      index: true,
    },
    last_event_type: {
      type: String,
      default: null,
      index: true,
    },
    raw_send_response: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    raw_last_webhook_payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    raw_last_error: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    error_message: {
      type: String,
      default: null,
    },
    error_code: {
      type: String,
      default: null,
    },
    error_http_status: {
      type: Number,
      default: null,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status_history: {
      type: [StatusHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

WhatsappTransportLogSchema.index(
  { school_id: 1, instance_name: 1, provider_message_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      provider_message_id: { $type: 'string' },
      instance_name: { $type: 'string' },
    },
  }
);

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeProviderStatus(value) {
  return normalizeString(value).toUpperCase() || null;
}

function toDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const normalized = value < 1e12 ? value * 1000 : value;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mergeMetadata(existing, incoming) {
  const current = existing && typeof existing === 'object' ? existing : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};

  return {
    ...current,
    ...next,
  };
}

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const cleaned = {};
  Object.entries(value).forEach(([key, item]) => {
    if (item !== undefined) {
      cleaned[key] = item;
    }
  });

  return cleaned;
}

function statusRankFor(status) {
  return STATUS_RANK[normalizeString(status)] || 0;
}

function canonicalStatusFrom({ providerStatus, eventType } = {}) {
  const normalizedProviderStatus = normalizeProviderStatus(providerStatus);
  const normalizedEventType = normalizeString(eventType).toUpperCase();

  if (normalizedProviderStatus === 'READ') return 'read';
  if (normalizedProviderStatus === 'DELIVERY_ACK') return 'delivered';
  if (normalizedProviderStatus === 'SERVER_ACK') return 'server_ack';
  if (normalizedProviderStatus === 'DELETED') return 'deleted';
  if (normalizedProviderStatus === 'ERROR') return 'failed';

  if (normalizedEventType === 'MESSAGES_DELETE') return 'deleted';
  if (
    normalizedEventType === 'SEND_MESSAGE' ||
    normalizedEventType === 'SEND_MESSAGE_UPDATE' ||
    normalizedEventType === 'MESSAGES_UPDATE'
  ) {
    return 'accepted_by_evolution';
  }

  if (normalizedProviderStatus === 'PENDING') {
    return 'accepted_by_evolution';
  }

  return 'accepted_by_evolution';
}

function setEarliestTimestamp(doc, field, candidate) {
  const normalizedCandidate = toDate(candidate);
  if (!normalizedCandidate) return;

  const current = toDate(doc[field]);
  if (!current || normalizedCandidate.getTime() < current.getTime()) {
    doc[field] = normalizedCandidate;
  }
}

function setLatestTimestamp(doc, field, candidate) {
  const normalizedCandidate = toDate(candidate);
  if (!normalizedCandidate) return;

  const current = toDate(doc[field]);
  if (!current || normalizedCandidate.getTime() > current.getTime()) {
    doc[field] = normalizedCandidate;
  }
}

function applyCanonicalStageTimestamp(doc, canonicalStatus, at) {
  const timestamp = toDate(at) || new Date();

  setEarliestTimestamp(doc, 'queued_at', timestamp);

  if (canonicalStatus === 'accepted_by_evolution') {
    setEarliestTimestamp(doc, 'accepted_at', timestamp);
  }

  if (canonicalStatus === 'server_ack') {
    setEarliestTimestamp(doc, 'accepted_at', timestamp);
    setEarliestTimestamp(doc, 'server_ack_at', timestamp);
  }

  if (canonicalStatus === 'delivered') {
    setEarliestTimestamp(doc, 'accepted_at', timestamp);
    setEarliestTimestamp(doc, 'server_ack_at', timestamp);
    setEarliestTimestamp(doc, 'delivered_at', timestamp);
  }

  if (canonicalStatus === 'read') {
    setEarliestTimestamp(doc, 'accepted_at', timestamp);
    setEarliestTimestamp(doc, 'server_ack_at', timestamp);
    setEarliestTimestamp(doc, 'delivered_at', timestamp);
    setEarliestTimestamp(doc, 'read_at', timestamp);
  }

  if (canonicalStatus === 'failed') {
    setEarliestTimestamp(doc, 'failed_at', timestamp);
  }

  if (canonicalStatus === 'deleted') {
    setEarliestTimestamp(doc, 'deleted_at', timestamp);
  }
}

function pushHistory(doc, entry) {
  const nextEntry = cleanObject(entry);

  if (!Array.isArray(doc.status_history)) {
    doc.status_history = [];
  }

  doc.status_history.push(nextEntry);

  if (doc.status_history.length > 20) {
    doc.status_history = doc.status_history.slice(-20);
  }
}

function getStringField(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

WhatsappTransportLogSchema.statics.recordSendAcceptance = async function recordSendAcceptance(input = {}) {
  const {
    schoolId,
    instanceName,
    instanceId = null,
    providerMessageId = null,
    remoteJid = null,
    destination = null,
    providerStatus = null,
    providerMessageTimestamp = null,
    queuedAt = null,
    acceptedAt = null,
    rawSendResponse = null,
    source = 'whatsapp.service',
    metadata = {},
  } = input;

  if (!schoolId || !instanceName) {
    throw new Error('schoolId e instanceName sao obrigatorios para registro de transporte.');
  }

  const normalizedProviderMessageId = getStringField(providerMessageId);
  const normalizedProviderStatus = normalizeProviderStatus(providerStatus);
  const canonicalStatus = canonicalStatusFrom({
    providerStatus: normalizedProviderStatus,
    eventType: 'SEND_MESSAGE',
  });
  const canonicalRank = statusRankFor(canonicalStatus);
  const eventAt = toDate(acceptedAt) || new Date();
  const queuedTimestamp = toDate(queuedAt) || eventAt;
  const providerTimestamp = toDate(providerMessageTimestamp);

  let doc = null;
  if (normalizedProviderMessageId) {
    doc = await this.findOne({
      school_id: schoolId,
      instance_name: instanceName,
      provider_message_id: normalizedProviderMessageId,
    });
  }

  if (!doc) {
    doc = new this({
      school_id: schoolId,
      instance_name: instanceName,
      provider_message_id: normalizedProviderMessageId,
      queued_at: queuedTimestamp,
      status: 'queued',
      status_rank: STATUS_RANK.queued,
      source: source || 'whatsapp.service',
      metadata: mergeMetadata({}, metadata),
    });
  }

  const previousLastEventAt = toDate(doc.last_event_at);

  setEarliestTimestamp(doc, 'queued_at', queuedTimestamp);
  setLatestTimestamp(doc, 'last_event_at', eventAt);
  if (!previousLastEventAt || eventAt.getTime() >= previousLastEventAt.getTime()) {
    doc.last_event_type = 'SEND_MESSAGE';
  }

  if (instanceId && !doc.instance_id) {
    doc.instance_id = String(instanceId);
  }

  if (normalizedProviderMessageId && !doc.provider_message_id) {
    doc.provider_message_id = normalizedProviderMessageId;
  }

  if (remoteJid && !doc.remote_jid) {
    doc.remote_jid = String(remoteJid);
  }

  if (destination && !doc.destination) {
    doc.destination = String(destination);
  }

  if (normalizedProviderStatus && canonicalRank >= statusRankFor(doc.status)) {
    doc.provider_status = normalizedProviderStatus;
  }

  if (providerTimestamp && !doc.provider_message_timestamp) {
    doc.provider_message_timestamp = providerTimestamp;
  }

  if (canonicalRank >= statusRankFor(doc.status)) {
    doc.status = canonicalStatus;
    doc.status_rank = canonicalRank;
  }

  applyCanonicalStageTimestamp(doc, canonicalStatus, eventAt);

  doc.raw_send_response = rawSendResponse ?? doc.raw_send_response;
  doc.raw_last_error = null;
  doc.error_message = null;
  doc.error_code = null;
  doc.error_http_status = null;
  doc.attempts = Math.max(Number(doc.attempts || 0), 1);
  doc.source = doc.source || source || 'whatsapp.service';
  doc.metadata = mergeMetadata(doc.metadata, metadata);

  pushHistory(doc, {
    event_type: 'SEND_REQUEST',
    canonical_status: 'queued',
    provider_status: null,
    occurred_at: queuedTimestamp,
    raw_payload: null,
    source,
    metadata,
  });

  pushHistory(doc, {
    event_type: 'SEND_MESSAGE',
    canonical_status: canonicalStatus,
    provider_status: normalizedProviderStatus,
    occurred_at: eventAt,
    raw_payload: rawSendResponse,
    source,
    metadata,
  });

  await doc.save();
  return doc;
};

WhatsappTransportLogSchema.statics.recordSendFailure = async function recordSendFailure(input = {}) {
  const {
    schoolId,
    instanceName,
    instanceId = null,
    providerMessageId = null,
    remoteJid = null,
    destination = null,
    providerStatus = null,
    queuedAt = null,
    failedAt = null,
    errorMessage = null,
    errorCode = null,
    errorHttpStatus = null,
    rawError = null,
    source = 'whatsapp.service',
    metadata = {},
  } = input;

  if (!schoolId || !instanceName) {
    throw new Error('schoolId e instanceName sao obrigatorios para registro de falha.');
  }

  const normalizedProviderMessageId = getStringField(providerMessageId);
  const normalizedProviderStatus = normalizeProviderStatus(providerStatus);
  const eventAt = toDate(failedAt) || new Date();
  const queuedTimestamp = toDate(queuedAt) || eventAt;

  let doc = null;
  if (normalizedProviderMessageId) {
    doc = await this.findOne({
      school_id: schoolId,
      instance_name: instanceName,
      provider_message_id: normalizedProviderMessageId,
    });
  }

  if (!doc) {
    doc = new this({
      school_id: schoolId,
      instance_name: instanceName,
      provider_message_id: normalizedProviderMessageId,
      queued_at: queuedTimestamp,
      status: 'queued',
      status_rank: STATUS_RANK.queued,
      source: source || 'whatsapp.service',
      metadata: mergeMetadata({}, metadata),
    });
  }

  const currentRank = statusRankFor(doc.status);
  const shouldMarkFailed = currentRank < STATUS_RANK.delivered;
  const previousLastEventAt = toDate(doc.last_event_at);

  setEarliestTimestamp(doc, 'queued_at', queuedTimestamp);
  setLatestTimestamp(doc, 'last_event_at', eventAt);
  if (!previousLastEventAt || eventAt.getTime() >= previousLastEventAt.getTime()) {
    doc.last_event_type = 'SEND_MESSAGE_ERROR';
  }

  if (instanceId && !doc.instance_id) {
    doc.instance_id = String(instanceId);
  }

  if (normalizedProviderMessageId && !doc.provider_message_id) {
    doc.provider_message_id = normalizedProviderMessageId;
  }

  if (remoteJid && !doc.remote_jid) {
    doc.remote_jid = String(remoteJid);
  }

  if (destination && !doc.destination) {
    doc.destination = String(destination);
  }

  if (normalizedProviderStatus && shouldMarkFailed) {
    doc.provider_status = normalizedProviderStatus;
  }

  if (shouldMarkFailed) {
    doc.status = 'failed';
    doc.status_rank = STATUS_RANK.failed;
  }

  if (shouldMarkFailed) {
    applyCanonicalStageTimestamp(doc, 'failed', eventAt);
    doc.error_message = errorMessage || null;
    doc.error_code = errorCode || null;
    doc.error_http_status = errorHttpStatus || null;
    doc.raw_last_error = cleanObject(rawError) ?? rawError ?? null;
  }
  doc.attempts = Math.max(Number(doc.attempts || 0), 1);
  doc.source = doc.source || source || 'whatsapp.service';
  doc.metadata = mergeMetadata(doc.metadata, metadata);

  pushHistory(doc, {
    event_type: 'SEND_REQUEST',
    canonical_status: 'queued',
    provider_status: null,
    occurred_at: queuedTimestamp,
    raw_payload: null,
    source,
    metadata,
  });

  pushHistory(doc, {
    event_type: 'SEND_MESSAGE_ERROR',
    canonical_status: 'failed',
    provider_status: normalizedProviderStatus,
    occurred_at: eventAt,
    raw_payload: rawError,
    source,
    metadata,
    error_message: errorMessage,
    error_code: errorCode,
    error_http_status: errorHttpStatus,
  });

  await doc.save();
  return doc;
};

WhatsappTransportLogSchema.statics.recordWebhookEvent = async function recordWebhookEvent(input = {}) {
  const {
    schoolId,
    instanceName,
    instanceId = null,
    providerMessageId = null,
    remoteJid = null,
    destination = null,
    providerStatus = null,
    providerMessageTimestamp = null,
    eventType = null,
    eventAt = null,
    rawWebhookPayload = null,
    source = 'evolution.webhook',
    metadata = {},
  } = input;

  if (!schoolId || !instanceName) {
    throw new Error('schoolId e instanceName sao obrigatorios para registro de webhook.');
  }

  const normalizedProviderMessageId = getStringField(providerMessageId);
  const normalizedProviderStatus = normalizeProviderStatus(providerStatus);
  const normalizedEventType = normalizeString(eventType).toUpperCase();
  const canonicalStatus = canonicalStatusFrom({
    providerStatus: normalizedProviderStatus,
    eventType: normalizedEventType,
  });
  const canonicalRank = statusRankFor(canonicalStatus);
  const timestamp = toDate(eventAt) || new Date();
  const providerTimestamp = toDate(providerMessageTimestamp);

  let doc = null;
  if (normalizedProviderMessageId) {
    doc = await this.findOne({
      school_id: schoolId,
      instance_name: instanceName,
      provider_message_id: normalizedProviderMessageId,
    });
  }

  if (!doc) {
    doc = new this({
      school_id: schoolId,
      instance_name: instanceName,
      provider_message_id: normalizedProviderMessageId,
      queued_at: timestamp,
      status: 'queued',
      status_rank: STATUS_RANK.queued,
      source: source || 'evolution.webhook',
      metadata: mergeMetadata({}, metadata),
    });
  }

  const currentRank = statusRankFor(doc.status);
  const shouldMarkFailed = canonicalStatus !== 'failed' || currentRank < STATUS_RANK.delivered;
  const previousLastEventAt = toDate(doc.last_event_at);

  setEarliestTimestamp(doc, 'queued_at', timestamp);
  setLatestTimestamp(doc, 'last_event_at', timestamp);
  if (!previousLastEventAt || timestamp.getTime() >= previousLastEventAt.getTime()) {
    doc.last_event_type = normalizedEventType || 'WEBHOOK_EVENT';
  }

  if (instanceId && !doc.instance_id) {
    doc.instance_id = String(instanceId);
  }

  if (normalizedProviderMessageId && !doc.provider_message_id) {
    doc.provider_message_id = normalizedProviderMessageId;
  }

  if (remoteJid && !doc.remote_jid) {
    doc.remote_jid = String(remoteJid);
  }

  if (destination && !doc.destination) {
    doc.destination = String(destination);
  }

  if (normalizedProviderStatus && canonicalRank >= currentRank && shouldMarkFailed) {
    doc.provider_status = normalizedProviderStatus;
  }

  if (providerTimestamp && !doc.provider_message_timestamp) {
    doc.provider_message_timestamp = providerTimestamp;
  }

  if (canonicalRank >= currentRank && shouldMarkFailed) {
    doc.status = canonicalStatus;
    doc.status_rank = canonicalRank;
  }

  if (shouldMarkFailed) {
    applyCanonicalStageTimestamp(doc, canonicalStatus, timestamp);
  }

  doc.raw_last_webhook_payload = rawWebhookPayload ?? doc.raw_last_webhook_payload;
  doc.attempts = Math.max(Number(doc.attempts || 0), 1);
  doc.source = doc.source || source || 'evolution.webhook';
  doc.metadata = mergeMetadata(doc.metadata, metadata);

  pushHistory(doc, {
    event_type: normalizedEventType || 'WEBHOOK_EVENT',
    canonical_status: canonicalStatus,
    provider_status: normalizedProviderStatus,
    occurred_at: timestamp,
    raw_payload: rawWebhookPayload,
    source,
    metadata,
  });

  await doc.save();
  return doc;
};

module.exports = mongoose.model('WhatsappTransportLog', WhatsappTransportLogSchema);
