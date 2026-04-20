const { createHash } = require('crypto');

const OFFICIAL_DOCUMENT_REQUESTER_TYPES = ['school', 'guardian', 'student'];
const OFFICIAL_DOCUMENT_ACTOR_TYPES = [...OFFICIAL_DOCUMENT_REQUESTER_TYPES, 'system'];
const OFFICIAL_DOCUMENT_REQUEST_STATUSES = [
  'requested',
  'under_review',
  'approved',
  'rejected',
  'awaiting_signature',
  'signed',
  'published',
  'downloaded',
  'cancelled',
];
const OFFICIAL_DOCUMENT_STATUSES = [
  'draft',
  'signed',
  'published',
  'superseded',
  'cancelled',
];
const OFFICIAL_DOCUMENT_SIGNATURE_PROVIDERS = ['local_windows_certificate'];
const OFFICIAL_DOCUMENT_STORAGE_PROVIDERS = ['mongodb_buffer'];

const OFFICIAL_DOCUMENT_TYPE_ALIASES = {
  enrollment_declaration: 'enrollment_confirmation',
  declaration_of_enrollment: 'enrollment_confirmation',
  enrollment_status_declaration: 'enrollment_status',
  attendance_declaration: 'enrollment_status',
  student_attendance_declaration: 'enrollment_status',
  no_debt_declaration: 'nothing_pending',
  no_pending_declaration: 'nothing_pending',
  nothing_pending_declaration: 'nothing_pending',
  income_tax_declaration: 'income_tax',
  irpf_declaration: 'income_tax',
};

const OFFICIAL_DOCUMENT_REQUEST_TRANSITIONS = {
  requested: ['under_review', 'approved', 'rejected', 'cancelled', 'awaiting_signature'],
  under_review: ['approved', 'rejected', 'cancelled', 'awaiting_signature'],
  approved: ['awaiting_signature', 'signed', 'cancelled'],
  awaiting_signature: ['signed', 'cancelled'],
  signed: ['published', 'cancelled'],
  published: ['downloaded', 'signed', 'cancelled'],
  downloaded: ['published', 'signed', 'cancelled'],
  rejected: [],
  cancelled: [],
};

const OFFICIAL_DOCUMENT_TRANSITIONS = {
  draft: ['signed', 'cancelled'],
  signed: ['published', 'superseded', 'cancelled'],
  published: ['superseded', 'cancelled'],
  superseded: [],
  cancelled: [],
};

const DEFAULT_MAX_PDF_BYTES = 10 * 1024 * 1024;

const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source || {}, key);

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const normalizeString = (value) => {
  if (!hasValue(value)) return null;

  const normalized = String(value).trim();
  return normalized ? normalized : null;
};

const normalizeOfficialDocumentType = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  return OFFICIAL_DOCUMENT_TYPE_ALIASES[normalized] || normalized;
};

const parseBoolean = (value, defaultValue = false) => {
  if (!hasValue(value)) return defaultValue;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  return defaultValue;
};

const normalizeArray = (value) => {
  if (!hasValue(value)) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeArray(item));
  }
  return [value];
};

const normalizeObjectIdList = (value) => (
  [...new Set(
    normalizeArray(value)
      .map((item) => {
        if (item && typeof item === 'object' && item._id) {
          return String(item._id);
        }

        return normalizeString(item);
      })
      .filter(Boolean)
  )]
);

const slugify = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9.]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .replace(/-{2,}/g, '-');

const sanitizeFileName = (value, fallback = 'documento-assinado.pdf') => {
  const normalized = normalizeString(value) || fallback;
  const safeFileName = normalized
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const finalName = safeFileName || fallback;
  return /\.pdf$/i.test(finalName) ? finalName : `${finalName}.pdf`;
};

const getOfficialDocumentMaxPdfBytes = () => {
  const rawValue = Number(process.env.OFFICIAL_DOCUMENT_MAX_PDF_BYTES || DEFAULT_MAX_PDF_BYTES);
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : DEFAULT_MAX_PDF_BYTES;
};

const isPdfBuffer = (buffer) => Buffer.isBuffer(buffer) && buffer.subarray(0, 4).toString('ascii') === '%PDF';

const hashBufferSha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const createHttpError = (message, statusCode = 400, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

const assertEnumValue = (value, allowedValues, fieldLabel) => {
  if (!allowedValues.includes(value)) {
    throw createHttpError(`${fieldLabel} invalido.`, 400, {
      code: `${fieldLabel}_invalid`,
    });
  }
};

const assertTransition = (transitions, currentStatus, nextStatus, fieldLabel) => {
  if (currentStatus === nextStatus) return;

  const allowedTransitions = transitions[currentStatus] || [];
  if (!allowedTransitions.includes(nextStatus)) {
    throw createHttpError(
      `Nao e permitido mudar ${fieldLabel} de '${currentStatus}' para '${nextStatus}'.`,
      409,
      { code: `${fieldLabel}_transition_not_allowed` }
    );
  }
};

const buildActorContext = (actorType, actorId = null) => ({
  actorType,
  actorId: actorId || null,
});

const buildAuditEvent = ({
  eventType,
  actorType = 'system',
  actorId = null,
  fromStatus = null,
  toStatus = null,
  note = null,
  metadata = null,
  occurredAt = new Date(),
}) => ({
  eventType,
  occurredAt,
  actorType,
  actorId: actorId || null,
  fromStatus,
  toStatus,
  note,
  metadata,
});

const calculateAgeAt = (birthDate, referenceDate = new Date()) => {
  if (!birthDate) return null;

  const birth = new Date(birthDate);
  const reference = new Date(referenceDate);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) {
    return null;
  }

  let age = reference.getFullYear() - birth.getFullYear();
  const monthDiff = reference.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && reference.getDate() < birth.getDate())) {
    age -= 1;
  }

  return age;
};

module.exports = {
  OFFICIAL_DOCUMENT_REQUESTER_TYPES,
  OFFICIAL_DOCUMENT_ACTOR_TYPES,
  OFFICIAL_DOCUMENT_REQUEST_STATUSES,
  OFFICIAL_DOCUMENT_STATUSES,
  OFFICIAL_DOCUMENT_SIGNATURE_PROVIDERS,
  OFFICIAL_DOCUMENT_STORAGE_PROVIDERS,
  OFFICIAL_DOCUMENT_TYPE_ALIASES,
  OFFICIAL_DOCUMENT_REQUEST_TRANSITIONS,
  OFFICIAL_DOCUMENT_TRANSITIONS,
  DEFAULT_MAX_PDF_BYTES,
  hasOwn,
  hasValue,
  normalizeString,
  normalizeOfficialDocumentType,
  parseBoolean,
  normalizeArray,
  normalizeObjectIdList,
  slugify,
  sanitizeFileName,
  getOfficialDocumentMaxPdfBytes,
  isPdfBuffer,
  hashBufferSha256,
  createHttpError,
  assertEnumValue,
  assertTransition,
  buildActorContext,
  buildAuditEvent,
  calculateAgeAt,
};
