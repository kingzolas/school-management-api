const mongoose = require('mongoose');

const DELIVERY_CHANNELS = ['whatsapp', 'email'];
const NOTIFICATION_TYPES = ['new_invoice', 'reminder', 'overdue', 'due_today', 'manual'];
const NOTIFICATION_STATUSES = ['queued', 'processing', 'sent', 'failed', 'cancelled', 'skipped'];
const RECIPIENT_ROLES = ['student', 'tutor', 'unknown'];

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeEmail(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function sameText(a, b) {
  const left = normalizeString(a);
  const right = normalizeString(b);

  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

function getFirstName(name) {
  const normalized = normalizeString(name);
  if (!normalized) return null;

  const [firstName] = normalized.split(/\s+/);
  return firstName || null;
}

function getObjectIdOrNull(value) {
  if (!isPresent(value)) return null;
  return value;
}

function isValidRecipientRole(value) {
  return RECIPIENT_ROLES.includes(String(value || '').trim().toLowerCase());
}

function inferDeliveryChannel(source = {}) {
  const current = normalizeString(source.delivery_channel);
  if (current && DELIVERY_CHANNELS.includes(current)) {
    return current;
  }

  const targetEmail = normalizeEmail(source.target_email || source?.recipient_snapshot?.email);
  const targetPhone = normalizeString(source.target_phone || source?.recipient_snapshot?.phone);

  if (targetEmail && !targetPhone) {
    return 'email';
  }

  return 'whatsapp';
}

function inferProvider(source = {}) {
  const existingProvider = normalizeString(source.provider);
  if (existingProvider) return existingProvider;

  const channel = inferDeliveryChannel(source);
  if (channel === 'email') return 'gmail';
  if (channel === 'whatsapp') return 'evolution';
  return null;
}

function inferRecipientRole(source = {}) {
  const explicitRole = normalizeString(source.recipient_role || source?.recipient_snapshot?.role);
  if (isValidRecipientRole(explicitRole) && explicitRole !== 'unknown') {
    return explicitRole;
  }

  if (isPresent(source.recipient_tutor_id) || isPresent(source?.recipient_snapshot?.tutor_id)) {
    return 'tutor';
  }

  if (isPresent(source.recipient_student_id) || isPresent(source?.recipient_snapshot?.student_id)) {
    return 'student';
  }

  const recipientName = normalizeString(source.recipient_name || source?.recipient_snapshot?.name);
  const studentName = normalizeString(source.student_name);
  const tutorName = normalizeString(source.tutor_name);

  if (recipientName && sameText(recipientName, studentName) && !sameText(studentName, tutorName)) {
    return 'student';
  }

  if (recipientName && sameText(recipientName, tutorName) && !sameText(studentName, tutorName)) {
    return 'tutor';
  }

  return 'unknown';
}

function buildMinimalRecipientSnapshot(source = {}) {
  const existingSnapshot = source.recipient_snapshot && typeof source.recipient_snapshot === 'object'
    ? source.recipient_snapshot
    : {};

  const role = inferRecipientRole({
    ...source,
    recipient_snapshot: existingSnapshot,
  });

  const studentId = getObjectIdOrNull(
    source.recipient_student_id ||
    existingSnapshot.student_id ||
    source?.invoice_snapshot?.student
  );

  const tutorId = getObjectIdOrNull(
    source.recipient_tutor_id ||
    existingSnapshot.tutor_id ||
    source?.invoice_snapshot?.tutor
  );

  const studentName = normalizeString(source.student_name);
  const tutorName = normalizeString(source.tutor_name);

  const name = normalizeString(
    source.recipient_name ||
    existingSnapshot.name ||
    (role === 'student' ? studentName : null) ||
    (role === 'tutor' ? tutorName : null) ||
    tutorName ||
    studentName
  );

  const phone = normalizeString(source.target_phone || existingSnapshot.phone);
  const phoneNormalized = normalizeString(
    source.target_phone_normalized ||
    existingSnapshot.phone_normalized ||
    source.target_phone ||
    existingSnapshot.phone
  );

  const email = normalizeEmail(source.target_email || existingSnapshot.email);
  const emailNormalized = normalizeEmail(
    source.target_email_normalized ||
    existingSnapshot.email_normalized ||
    source.target_email ||
    existingSnapshot.email
  );

  return {
    role,
    student_id: studentId,
    tutor_id: tutorId,
    name,
    first_name: normalizeString(existingSnapshot.first_name) || getFirstName(name),
    phone,
    phone_normalized: phoneNormalized,
    email,
    email_normalized: emailNormalized,
  };
}

function hasMeaningfulSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;

  return [
    snapshot.name,
    snapshot.phone,
    snapshot.phone_normalized,
    snapshot.email,
    snapshot.email_normalized,
    snapshot.student_id,
    snapshot.tutor_id,
    snapshot.role && snapshot.role !== 'unknown' ? snapshot.role : null,
  ].some((value) => isPresent(value));
}

function mergeRecipientSnapshot(existingSnapshot = {}, derivedSnapshot = {}) {
  const current = existingSnapshot && typeof existingSnapshot === 'object' ? existingSnapshot : {};
  const derived = derivedSnapshot && typeof derivedSnapshot === 'object' ? derivedSnapshot : {};

  const mergedRole =
    isValidRecipientRole(current.role) && current.role !== 'unknown'
      ? current.role
      : derived.role || 'unknown';

  return {
    role: mergedRole,
    student_id: current.student_id || derived.student_id || null,
    tutor_id: current.tutor_id || derived.tutor_id || null,
    name: normalizeString(current.name) || normalizeString(derived.name),
    first_name: normalizeString(current.first_name) || normalizeString(derived.first_name),
    phone: normalizeString(current.phone) || normalizeString(derived.phone),
    phone_normalized: normalizeString(current.phone_normalized) || normalizeString(derived.phone_normalized),
    email: normalizeEmail(current.email) || normalizeEmail(derived.email),
    email_normalized: normalizeEmail(current.email_normalized) || normalizeEmail(derived.email_normalized),
  };
}

function buildCompatibilityPatch(source = {}) {
  const patch = {};
  const channel = inferDeliveryChannel(source);
  const provider = inferProvider({ ...source, delivery_channel: channel });
  const derivedSnapshot = buildMinimalRecipientSnapshot({
    ...source,
    delivery_channel: channel,
    provider,
  });
  const mergedSnapshot = mergeRecipientSnapshot(source.recipient_snapshot, derivedSnapshot);

  if (!isValidRecipientRole(source.recipient_role) || source.recipient_role === 'unknown') {
    patch.recipient_role = mergedSnapshot.role || 'unknown';
  }

  if (!isPresent(source.recipient_student_id) && isPresent(mergedSnapshot.student_id)) {
    patch.recipient_student_id = mergedSnapshot.student_id;
  }

  if (!isPresent(source.recipient_tutor_id) && isPresent(mergedSnapshot.tutor_id)) {
    patch.recipient_tutor_id = mergedSnapshot.tutor_id;
  }

  if (!isPresent(source.recipient_name) && isPresent(mergedSnapshot.name)) {
    patch.recipient_name = mergedSnapshot.name;
  }

  if (!isPresent(source.target_phone_normalized) && isPresent(mergedSnapshot.phone_normalized)) {
    patch.target_phone_normalized = mergedSnapshot.phone_normalized;
  }

  if (!isPresent(source.target_email) && isPresent(mergedSnapshot.email)) {
    patch.target_email = mergedSnapshot.email;
  }

  if (!isPresent(source.target_email_normalized) && isPresent(mergedSnapshot.email_normalized)) {
    patch.target_email_normalized = mergedSnapshot.email_normalized;
  }

  if (!DELIVERY_CHANNELS.includes(String(source.delivery_channel || '').trim())) {
    patch.delivery_channel = channel;
  }

  if (!isPresent(source.provider) && isPresent(provider)) {
    patch.provider = provider;
  }

  if (hasMeaningfulSnapshot(mergedSnapshot)) {
    const currentSnapshot = source.recipient_snapshot && typeof source.recipient_snapshot === 'object'
      ? source.recipient_snapshot
      : null;

    if (!currentSnapshot || JSON.stringify(currentSnapshot) !== JSON.stringify(mergedSnapshot)) {
      patch.recipient_snapshot = mergedSnapshot;
    }
  }

  return patch;
}

const RecipientSnapshotSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: RECIPIENT_ROLES,
      default: 'unknown',
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
    },
    tutor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tutor',
      default: null,
    },
    name: { type: String, default: null },
    first_name: { type: String, default: null },
    phone: { type: String, default: null },
    phone_normalized: { type: String, default: null },
    email: { type: String, default: null },
    email_normalized: { type: String, default: null },
  },
  { _id: false }
);

const InvoiceSnapshotSchema = new mongoose.Schema(
  {
    description: { type: String, default: null },
    value: { type: Number, default: null },
    dueDate: { type: Date, default: null },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
    tutor: { type: mongoose.Schema.Types.ObjectId, ref: 'Tutor', default: null },
    gateway: { type: String, default: null },
    paymentMethod: { type: String, default: null },
    external_id: { type: String, default: null },
    boleto_url: { type: String, default: null },
    boleto_barcode: { type: String, default: null },
    boleto_digitable_line: { type: String, default: null },
    pix_code: { type: String, default: null },
  },
  { _id: false }
);

const NotificationLogSchema = new mongoose.Schema(
  {
    school_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    invoice_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true,
    },

    recipient_role: {
      type: String,
      enum: RECIPIENT_ROLES,
      default: 'unknown',
      index: true,
    },
    recipient_student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
    },
    recipient_tutor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tutor',
      default: null,
    },
    recipient_name: { type: String, default: null },

    student_name: { type: String, default: null },
    tutor_name: { type: String, default: null },

    target_phone: { type: String, default: null },
    target_phone_normalized: {
      type: String,
      default: null,
      index: true,
    },
    target_email: { type: String, default: null },
    target_email_normalized: {
      type: String,
      default: null,
      index: true,
    },
    recipient_snapshot: {
      type: RecipientSnapshotSchema,
      default: null,
    },

    delivery_channel: {
      type: String,
      enum: DELIVERY_CHANNELS,
      default: 'whatsapp',
      index: true,
    },
    provider: {
      type: String,
      default: null,
      index: true,
    },
    channel_resolution_reason: {
      type: String,
      default: null,
    },

    business_day: {
      type: String,
      default: null,
      index: true,
    },
    business_timezone: {
      type: String,
      default: 'America/Sao_Paulo',
      index: true,
    },
    delivery_key: {
      type: String,
      default: null,
      index: true,
    },
    dispatch_origin: {
      type: String,
      default: 'cron_scan',
      index: true,
    },
    dispatch_reference_key: {
      type: String,
      default: null,
      index: true,
    },

    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      default: 'new_invoice',
    },
    status: {
      type: String,
      enum: NOTIFICATION_STATUSES,
      default: 'queued',
      index: true,
    },

    scheduled_for: { type: Date, default: Date.now },
    processing_started_at: { type: Date, default: null },
    sent_at: { type: Date, default: null },
    cancelled_at: { type: Date, default: null },
    cancelled_by_action: { type: String, default: null, index: true },
    cancelled_reason: { type: String, default: null },
    attempts: { type: Number, default: 0 },

    last_transport_log_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NotificationTransportLog',
      default: null,
    },
    last_transport_status: { type: String, default: null },
    last_transport_canonical_status: { type: String, default: null },

    error_message: { type: String, default: null },
    error_code: { type: String, default: null },
    error_http_status: { type: Number, default: null },
    error_raw: { type: String, default: null },

    outcome_code: { type: String, default: null, index: true },
    outcome_category: { type: String, default: null },
    outcome_title: { type: String, default: null },
    outcome_user_message: { type: String, default: null },
    outcome_retryable: { type: Boolean, default: null },
    outcome_field: { type: String, default: null },
    skipped_at: { type: Date, default: null },

    template_group: { type: String, default: null },
    template_index: { type: Number, default: null },
    message_subject: { type: String, default: null },
    message_text: { type: String, default: null },
    message_html_preview: { type: String, default: null },
    message_preview: { type: String, default: null },

    sent_boleto_url: { type: String, default: null },
    sent_barcode: { type: String, default: null },
    sent_digitable_line: { type: String, default: null },
    sent_gateway: { type: String, default: null },
    sent_gateway_charge_id: { type: String, default: null },

    invoice_snapshot: {
      type: InvoiceSnapshotSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

NotificationLogSchema.statics.buildMinimalRecipientSnapshot = buildMinimalRecipientSnapshot;
NotificationLogSchema.statics.buildCompatibilityPatch = buildCompatibilityPatch;

NotificationLogSchema.methods.applyCompatibilityFields = function applyCompatibilityFields() {
  const patch = buildCompatibilityPatch(this.toObject ? this.toObject() : this);

  Object.entries(patch).forEach(([key, value]) => {
    this[key] = value;
  });

  return this;
};

NotificationLogSchema.pre('validate', function hydrateCompatibility(next) {
  this.applyCompatibilityFields();
  next();
});

NotificationLogSchema.index(
  { school_id: 1, delivery_key: 1 },
  {
    unique: true,
    partialFilterExpression: {
      delivery_key: { $type: 'string' },
    },
  }
);

NotificationLogSchema.index(
  { school_id: 1, delivery_channel: 1, business_day: 1, status: 1 },
  {
    background: true,
    name: 'idx_notification_log_school_channel_day_status',
  }
);

NotificationLogSchema.index(
  { school_id: 1, invoice_id: 1, delivery_channel: 1, createdAt: -1 },
  {
    background: true,
    name: 'idx_notification_log_school_invoice_channel_created',
  }
);

module.exports = mongoose.model('NotificationLog', NotificationLogSchema);
