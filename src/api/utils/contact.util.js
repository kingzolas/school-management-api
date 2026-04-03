function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeEmail(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function isValidEmailFormat(value) {
  const email = normalizeEmail(value);
  if (!email) return false;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getEmailIssueCode(value) {
  const raw = normalizeString(value);
  if (!raw) return 'RECIPIENT_EMAIL_MISSING';
  if (!isValidEmailFormat(raw)) return 'RECIPIENT_EMAIL_INVALID';
  return null;
}

module.exports = {
  normalizeString,
  normalizeEmail,
  isValidEmailFormat,
  getEmailIssueCode,
};
