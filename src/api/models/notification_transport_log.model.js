const mongoose = require('mongoose');
const { normalizeWhatsappPhone } = require('../utils/timeContext');

const DELIVERY_CHANNELS = ['whatsapp', 'email'];
const CANONICAL_STATUSES = ['queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'bounced', 'cancelled'];

const STATUS_RANK = Object.freeze({
  queued: 10,
  accepted: 20,
  sent: 30,
  failed: 35,
  delivered: 40,
  read: 50,
  bounced: 70,
  cancelled: 80,
});

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeEmail(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function inferChannel(source = {}) {
  const explicit = normalizeString(source.channel);
  if (explicit && DELIVERY_CHANNELS.includes(explicit)) {
    return explicit;
  }

  if (normalizeEmail(source.destination_email)) {
    return 'email';
  }

  return 'whatsapp';
}

function inferProvider(source = {}) {
  const explicit = normalizeString(source.provider);
  if (explicit) return explicit;

  const channel = inferChannel(source);
  if (channel === 'email') return 'gmail';
  if (channel === 'whatsapp') return 'evolution';
  return null;
}

function inferCanonicalStatus(source = {}) {
  const explicit = normalizeString(source.canonical_status);
  if (explicit && CANONICAL_STATUSES.includes(explicit)) {
    return explicit;
  }

  const status = normalizeString(source.status);
  if (status && CANONICAL_STATUSES.includes(status)) {
    return status;
  }

  return 'queued';
}

const StatusHistorySchema = new mongoose.Schema(
  {
    event_type: { type: String, default: null },
    canonical_status: {
      type: String,
      enum: CANONICAL_STATUSES,
      default: 'queued',
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

const AttachmentSchema = new mongoose.Schema(
  {
    type: { type: String, default: null },
    filename: { type: String, default: null },
    mimeType: { type: String, default: null },
    sourceUrl: { type: String, default: null },
    providerAttachmentId: { type: String, default: null },
    size: { type: Number, default: null },
    required: { type: Boolean, default: false },
    fallbackToLink: { type: Boolean, default: true },
  },
  { _id: false }
);

const NotificationTransportLogSchema = new mongoose.Schema(
  {
    school_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    notification_log_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NotificationLog',
      default: null,
      index: true,
    },
    invoice_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
      index: true,
    },

    attempt_number: {
      type: Number,
      default: 1,
      min: 1,
    },

    channel: {
      type: String,
      enum: DELIVERY_CHANNELS,
      required: true,
      index: true,
    },
    provider: {
      type: String,
      default: null,
      index: true,
    },

    status: {
      type: String,
      default: 'queued',
      index: true,
    },
    canonical_status: {
      type: String,
      enum: CANONICAL_STATUSES,
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

    destination: {
      type: String,
      default: null,
      index: true,
    },
    destination_phone: {
      type: String,
      default: null,
    },
    destination_phone_normalized: {
      type: String,
      default: null,
      index: true,
    },
    destination_email: {
      type: String,
      default: null,
    },
    destination_email_normalized: {
      type: String,
      default: null,
      index: true,
    },

    provider_message_id: {
      type: String,
      default: null,
      index: true,
    },
    internet_message_id: {
      type: String,
      default: null,
      index: true,
    },
    provider_thread_id: {
      type: String,
      default: null,
      index: true,
    },
    provider_mailbox_event_id: {
      type: String,
      default: null,
      index: true,
    },

    instance_name: {
      type: String,
      default: null,
      index: true,
    },
    instance_id: {
      type: String,
      default: null,
      index: true,
    },
    remote_jid: {
      type: String,
      default: null,
      index: true,
    },

    request_kind: {
      type: String,
      default: 'text',
    },
    source: {
      type: String,
      default: null,
      index: true,
    },

    subject: { type: String, default: null },
    body_preview: { type: String, default: null },
    attachment_count: { type: Number, default: 0 },
    attachments: {
      type: [AttachmentSchema],
      default: [],
    },

    queued_at: { type: Date, default: null, index: true },
    accepted_at: { type: Date, default: null, index: true },
    sent_at: { type: Date, default: null, index: true },
    delivered_at: { type: Date, default: null, index: true },
    read_at: { type: Date, default: null, index: true },
    failed_at: { type: Date, default: null, index: true },
    cancelled_at: { type: Date, default: null, index: true },
    last_event_at: { type: Date, default: null, index: true },
    last_event_type: { type: String, default: null, index: true },

    error_message: { type: String, default: null },
    error_code: { type: String, default: null },
    error_http_status: { type: Number, default: null },

    raw_request_payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    raw_provider_response: {
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

NotificationTransportLogSchema.pre('validate', function normalizeTransportFields(next) {
  this.channel = inferChannel(this);
  this.provider = inferProvider(this);
  this.canonical_status = inferCanonicalStatus(this);
  this.status = normalizeString(this.status) || this.canonical_status;
  this.status_rank = STATUS_RANK[this.canonical_status] || STATUS_RANK.queued;

  if (!normalizeString(this.destination)) {
    this.destination = normalizeString(this.destination_email) || normalizeString(this.destination_phone);
  }

  if (!normalizeString(this.destination_phone_normalized) && normalizeString(this.destination_phone)) {
    this.destination_phone_normalized = normalizeWhatsappPhone(this.destination_phone) || null;
  }

  if (!normalizeEmail(this.destination_email_normalized) && normalizeEmail(this.destination_email)) {
    this.destination_email_normalized = normalizeEmail(this.destination_email);
  }

  if (!Array.isArray(this.attachments)) {
    this.attachments = [];
  }

  this.attachment_count = this.attachments.length;
  this.attempt_number = Math.max(Number(this.attempt_number || 1), 1);

  next();
});

NotificationTransportLogSchema.index(
  { notification_log_id: 1, attempt_number: 1 },
  {
    unique: true,
    partialFilterExpression: {
      notification_log_id: { $type: 'objectId' },
    },
    background: true,
    name: 'uniq_notification_transport_attempt',
  }
);

NotificationTransportLogSchema.index(
  { school_id: 1, provider: 1, provider_message_id: 1 },
  {
    partialFilterExpression: {
      provider_message_id: { $type: 'string' },
    },
    background: true,
    name: 'idx_notification_transport_provider_message',
  }
);

NotificationTransportLogSchema.index(
  { school_id: 1, invoice_id: 1, channel: 1 },
  {
    background: true,
    name: 'idx_notification_transport_school_invoice_channel',
  }
);

NotificationTransportLogSchema.index(
  { school_id: 1, notification_log_id: 1 },
  {
    background: true,
    name: 'idx_notification_transport_school_notification_log',
  }
);

module.exports = mongoose.model('NotificationTransportLog', NotificationTransportLogSchema);
