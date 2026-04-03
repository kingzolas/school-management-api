const Student = require('../models/student.model');
const Tutor = require('../models/tutor.model');
const { normalizeWhatsappPhone } = require('../utils/timeContext');
const {
  normalizeString,
  normalizeEmail,
  isValidEmailFormat,
  getEmailIssueCode,
} = require('../utils/contact.util');

function toPlainObject(value) {
  if (!value || typeof value !== 'object') return value;
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
}

function getObjectId(value) {
  if (!value) return null;

  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return value._id;
  return value;
}

function getFirstName(name) {
  const normalized = normalizeString(name);
  if (!normalized) return null;
  return normalized.split(/\s+/)[0] || null;
}

function buildUnknownResult(invoice = {}, reason = 'recipient_unresolved') {
  const plainInvoice = toPlainObject(invoice) || {};
  const plainStudent = toPlainObject(plainInvoice.student) || {};
  const plainTutor = toPlainObject(plainInvoice.tutor) || {};

  const studentName = normalizeString(plainStudent.fullName) || null;
  const tutorName = normalizeString(plainTutor.fullName) || null;
  const recipientName = tutorName || studentName;

  return {
    recipient_role: 'unknown',
    recipient_student_id: getObjectId(plainStudent._id || plainInvoice.student) || null,
    recipient_tutor_id: getObjectId(plainTutor._id || plainInvoice.tutor) || null,
    recipient_name: recipientName,
    student_name: studentName,
    tutor_name: tutorName,
    target_phone: null,
    target_phone_normalized: null,
    target_email: null,
    target_email_normalized: null,
    resolution_reason: reason,
    channel_issues: {
      whatsapp: 'RECIPIENT_PHONE_MISSING',
      email: 'RECIPIENT_EMAIL_MISSING',
    },
    email_valid: false,
    email_issue_code: 'RECIPIENT_EMAIL_MISSING',
    available_channels: {
      whatsapp: false,
      email: false,
    },
    recipient_snapshot: {
      role: 'unknown',
      student_id: getObjectId(plainStudent._id || plainInvoice.student) || null,
      tutor_id: getObjectId(plainTutor._id || plainInvoice.tutor) || null,
      name: recipientName,
      first_name: getFirstName(recipientName),
      phone: null,
      phone_normalized: null,
      email: null,
      email_normalized: null,
    },
  };
}

class NotificationRecipientResolverService {
  constructor({ StudentModel = Student, TutorModel = Tutor } = {}) {
    this.StudentModel = StudentModel;
    this.TutorModel = TutorModel;
  }

  _isPopulatedEntity(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  async _loadStudent(invoice, options = {}) {
    if (options.student) return toPlainObject(options.student);

    const invoiceStudent = toPlainObject(invoice?.student);
    if (this._isPopulatedEntity(invoiceStudent) && (invoiceStudent.fullName || invoiceStudent.email || invoiceStudent.phoneNumber || invoiceStudent.financialResp)) {
      return invoiceStudent;
    }

    const studentId = getObjectId(invoiceStudent || invoice?.student);
    if (!studentId) return null;

    const doc = await this.StudentModel.findById(studentId)
      .select('fullName email phoneNumber financialResp financialTutorId tutors')
      .lean();

    return doc || null;
  }

  async _loadTutorById(tutorId) {
    if (!tutorId) return null;

    const doc = await this.TutorModel.findById(tutorId)
      .select('fullName email phoneNumber')
      .lean();

    return doc || null;
  }

  async _loadDirectTutor(invoice, options = {}) {
    if (options.tutor) return toPlainObject(options.tutor);

    const invoiceTutor = toPlainObject(invoice?.tutor);
    if (this._isPopulatedEntity(invoiceTutor) && (invoiceTutor.fullName || invoiceTutor.email || invoiceTutor.phoneNumber)) {
      return invoiceTutor;
    }

    const tutorId = getObjectId(invoiceTutor || invoice?.tutor);
    return this._loadTutorById(tutorId);
  }

  _buildRecipientResult({
    invoice,
    student,
    tutor,
    role,
    resolutionReason,
  }) {
    const plainInvoice = toPlainObject(invoice) || {};
    const plainStudent = toPlainObject(student) || {};
    const plainTutor = toPlainObject(tutor) || {};

    const studentName = normalizeString(plainStudent.fullName);
    const tutorName = normalizeString(plainTutor.fullName);

    const recipientName = role === 'tutor'
      ? tutorName
      : role === 'student'
        ? studentName
        : (tutorName || studentName);

    const rawPhone = role === 'tutor'
      ? plainTutor.phoneNumber
      : role === 'student'
        ? plainStudent.phoneNumber
        : null;

    const rawEmail = role === 'tutor'
      ? plainTutor.email
      : role === 'student'
        ? plainStudent.email
        : null;

    const targetPhone = normalizeString(rawPhone);
    const targetPhoneNormalized = targetPhone ? normalizeWhatsappPhone(targetPhone) || null : null;
    const rawTargetEmail = normalizeString(rawEmail);
    const emailIssueCode = getEmailIssueCode(rawTargetEmail);
    const emailValid = !emailIssueCode && isValidEmailFormat(rawTargetEmail);
    const targetEmail = emailValid ? normalizeEmail(rawTargetEmail) : normalizeEmail(rawTargetEmail);
    const targetEmailNormalized = emailValid ? normalizeEmail(targetEmail) : null;

    return {
      recipient_role: role,
      recipient_student_id: getObjectId(plainStudent._id || plainInvoice.student) || null,
      recipient_tutor_id: getObjectId(plainTutor._id || plainInvoice.tutor) || null,
      recipient_name: recipientName,
      student_name: studentName,
      tutor_name: tutorName,
      target_phone: targetPhone,
      target_phone_normalized: targetPhoneNormalized,
      target_email: targetEmail,
      target_email_normalized: targetEmailNormalized,
      resolution_reason: resolutionReason,
      channel_issues: {
        whatsapp: targetPhoneNormalized ? null : 'RECIPIENT_PHONE_MISSING',
        email: emailIssueCode,
      },
      email_valid: emailValid,
      email_issue_code: emailIssueCode,
      available_channels: {
        whatsapp: Boolean(targetPhoneNormalized),
        email: Boolean(targetEmailNormalized && emailValid),
      },
      recipient_snapshot: {
        role,
        student_id: getObjectId(plainStudent._id || plainInvoice.student) || null,
        tutor_id: getObjectId(plainTutor._id || plainInvoice.tutor) || null,
        name: recipientName,
        first_name: getFirstName(recipientName),
        phone: targetPhone,
        phone_normalized: targetPhoneNormalized,
        email: targetEmail,
        email_normalized: targetEmailNormalized,
      },
    };
  }

  async resolveByInvoice(invoice, options = {}) {
    if (!invoice) {
      return buildUnknownResult(null, 'missing_invoice');
    }

    const student = await this._loadStudent(invoice, options);
    const directTutor = await this._loadDirectTutor(invoice, options);

    if (directTutor) {
      return this._buildRecipientResult({
        invoice,
        student,
        tutor: directTutor,
        role: 'tutor',
        resolutionReason: 'invoice_tutor_linked',
      });
    }

    if (student?.financialResp === 'TUTOR') {
      const financialTutor = await this._loadTutorById(student.financialTutorId);
      if (financialTutor) {
        return this._buildRecipientResult({
          invoice,
          student,
          tutor: financialTutor,
          role: 'tutor',
          resolutionReason: 'student_financial_tutor',
        });
      }

      const primaryTutorId = Array.isArray(student.tutors) ? student.tutors[0]?.tutorId : null;
      const primaryTutor = await this._loadTutorById(primaryTutorId);
      if (primaryTutor) {
        return this._buildRecipientResult({
          invoice,
          student,
          tutor: primaryTutor,
          role: 'tutor',
          resolutionReason: 'student_primary_tutor_fallback',
        });
      }

      return buildUnknownResult(invoice, 'financial_tutor_unresolved');
    }

    if (student) {
      return this._buildRecipientResult({
        invoice,
        student,
        tutor: null,
        role: 'student',
        resolutionReason: student.financialResp === 'STUDENT'
          ? 'student_financial_responsible'
          : 'student_fallback',
      });
    }

    return buildUnknownResult(invoice, 'recipient_unresolved');
  }
}

const service = new NotificationRecipientResolverService();

module.exports = service;
module.exports.NotificationRecipientResolverService = NotificationRecipientResolverService;
