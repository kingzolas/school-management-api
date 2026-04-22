const Attendance = require('../models/attendance.model');
const AbsenceJustification = require('../models/absenceJustification.model');
const AbsenceJustificationRequest = require('../models/absenceJustificationRequest.model');
const Class = require('../models/class.model');
const Enrollment = require('../models/enrollment.model');
const GuardianAccessLink = require('../models/guardianAccessLink.model');
const Student = require('../models/student.model');
const appEmitter = require('../../loaders/eventEmitter');
const AppNotificationService = require('./appNotification.service');

const DEFAULT_JUSTIFICATION_DEADLINE_DAYS = Number(
  process.env.ATTENDANCE_JUSTIFICATION_DEADLINE_DAYS || 3
);

const JUSTIFICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'];
const REQUEST_STATUSES = {
  PENDING: 'PENDING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  PARTIALLY_APPROVED: 'PARTIALLY_APPROVED',
  REJECTED: 'REJECTED',
  NEEDS_INFORMATION: 'NEEDS_INFORMATION',
  CANCELLED: 'CANCELLED',
};
const ACTIVE_REQUEST_STATUSES = [
  REQUEST_STATUSES.PENDING,
  REQUEST_STATUSES.UNDER_REVIEW,
  REQUEST_STATUSES.APPROVED,
  REQUEST_STATUSES.PARTIALLY_APPROVED,
  REQUEST_STATUSES.NEEDS_INFORMATION,
];
const REVIEWABLE_REQUEST_STATUSES = [
  REQUEST_STATUSES.PENDING,
  REQUEST_STATUSES.UNDER_REVIEW,
  REQUEST_STATUSES.NEEDS_INFORMATION,
];
const REQUEST_EVENTS = {
  created: 'absence_justification_request_created',
  updated: 'absence_justification_request_updated',
  approved: 'absence_justification_request_approved',
  partiallyApproved: 'absence_justification_request_partially_approved',
  rejected: 'absence_justification_request_rejected',
  needsInformation: 'absence_justification_request_needs_information',
  cancelled: 'absence_justification_request_cancelled',
  applied: 'absence_justification_request_applied',
};
const STAFF_TARGET_ROLES = ['Admin', 'Coordenador', 'Gestor', 'Secretaria'];
const DOCUMENT_TYPES_REQUIRING_ATTACHMENT = ['MEDICAL_CERTIFICATE', 'COURT_ORDER'];
const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
];
const MAX_REQUEST_RANGE_DAYS = Number(
  process.env.ABSENCE_JUSTIFICATION_REQUEST_MAX_DAYS || 30
);
const ATTENDANCE_ABSENCE_STATE_BY_JUSTIFICATION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
};

function parseLocalDate(dateValue) {
  if (!dateValue) return new Date();

  if (typeof dateValue === 'string') {
    const datePart = dateValue.split('T')[0];
    const [year, month, day] = datePart.split('-');

    if (year && month && day) {
      return new Date(year, parseInt(month, 10) - 1, day);
    }
  }

  return new Date(dateValue);
}

function startOfDay(dateValue) {
  const date = parseLocalDate(dateValue);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(dateValue) {
  const date = parseLocalDate(dateValue);
  date.setHours(23, 59, 59, 999);
  return date;
}

function addDays(dateValue, days) {
  const date = parseLocalDate(dateValue);
  date.setDate(date.getDate() + days);
  return date;
}

function normalizeDateList(absenceDates = []) {
  return absenceDates
    .map((date) => startOfDay(date))
    .sort((a, b) => a.getTime() - b.getTime())
    .filter((date, index, array) => index === 0 || date.getTime() !== array[index - 1].getTime());
}

function createServiceError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function extractId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
}

function toPlainRecord(record) {
  if (!record) return null;
  if (typeof record.toJSON === 'function') return record.toJSON();
  if (typeof record.toObject === 'function') return record.toObject();
  return record;
}

function dateKey(dateValue) {
  return startOfDay(dateValue).toISOString().slice(0, 10);
}

function expandDateRange(startDate, endDate) {
  const dates = [];
  const cursor = startOfDay(startDate);
  const end = startOfDay(endDate);

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function normalizeRequestRange(payload) {
  const start = payload.requestedStartDate || payload.startDate || payload.coverageStartDate;
  const end = payload.requestedEndDate || payload.endDate || payload.coverageEndDate || start;

  if (!start || !end) {
    throw createServiceError('Informe requestedStartDate e requestedEndDate.', 400, 'request_range_required');
  }

  const requestedStartDate = startOfDay(start);
  const requestedEndDate = startOfDay(end);

  if (requestedEndDate < requestedStartDate) {
    throw createServiceError(
      'requestedEndDate nao pode ser menor que requestedStartDate.',
      400,
      'invalid_request_range'
    );
  }

  const days = expandDateRange(requestedStartDate, requestedEndDate).length;
  if (days > MAX_REQUEST_RANGE_DAYS) {
    throw createServiceError(
      `O periodo da solicitacao nao pode ultrapassar ${MAX_REQUEST_RANGE_DAYS} dias.`,
      400,
      'request_range_too_large'
    );
  }

  return { requestedStartDate, requestedEndDate };
}

function normalizeDocumentType(value) {
  const normalized = String(value || 'OTHER').trim().toUpperCase();
  return ['MEDICAL_CERTIFICATE', 'DECLARATION', 'COURT_ORDER', 'OTHER'].includes(normalized)
    ? normalized
    : 'OTHER';
}

function normalizeApprovedDatesForRequest(value, requestedStartDate, requestedEndDate, options = {}) {
  const { defaultToFullRange = false, requireAtLeastOne = false } = options;
  let rawDates = Array.isArray(value) ? value : [];
  if (!Array.isArray(value) && typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      rawDates = JSON.parse(value);
    } catch (error) {
      throw createServiceError('approvedDates deve ser uma lista de datas valida.', 400, 'invalid_approved_dates');
    }
  } else if (!Array.isArray(value) && typeof value === 'string' && value.trim()) {
    rawDates = value.split(',').map((item) => item.trim()).filter(Boolean);
  }

  const dates = rawDates.length > 0
    ? normalizeDateList(rawDates)
    : (defaultToFullRange ? expandDateRange(requestedStartDate, requestedEndDate) : []);

  if (requireAtLeastOne && dates.length === 0) {
    throw createServiceError('Informe ao menos uma data aprovada.', 400, 'approved_dates_required');
  }

  const start = startOfDay(requestedStartDate);
  const end = startOfDay(requestedEndDate);
  const outOfRange = dates.find((date) => date < start || date > end);

  if (outOfRange) {
    throw createServiceError(
      'approvedDates deve conter apenas datas dentro do periodo solicitado.',
      400,
      'approved_dates_out_of_range'
    );
  }

  return normalizeDateList(dates);
}

function approvedDatesCoverFullRange(approvedDates, requestedStartDate, requestedEndDate) {
  const fullRangeKeys = new Set(expandDateRange(requestedStartDate, requestedEndDate).map(dateKey));
  const approvedKeys = new Set(normalizeDateList(approvedDates).map(dateKey));

  if (fullRangeKeys.size !== approvedKeys.size) return false;
  return [...fullRangeKeys].every((key) => approvedKeys.has(key));
}

function normalizeAttachmentFiles(files) {
  if (!files) return [];

  if (Array.isArray(files)) return files;

  if (files.document || files.attachments || files.file) {
    return [
      ...(Array.isArray(files.attachments) ? files.attachments : []),
      ...(Array.isArray(files.document) ? files.document : []),
      ...(Array.isArray(files.file) ? files.file : []),
    ];
  }

  return [];
}

function buildCoverageRange(payload) {
  if (Array.isArray(payload.absenceDates) && payload.absenceDates.length > 0) {
    const dates = normalizeDateList(payload.absenceDates);
    return {
      absenceDates: dates,
      coverageStartDate: dates[0],
      coverageEndDate: dates[dates.length - 1],
    };
  }

  const start = payload.coverageStartDate || payload.date;
  const end = payload.coverageEndDate || payload.coverageStartDate || payload.date;

  if (!start || !end) {
    throw new Error('Informe absenceDates ou coverageStartDate/coverageEndDate.');
  }

  const normalizedStart = startOfDay(start);
  const normalizedEnd = startOfDay(end);

  if (normalizedEnd < normalizedStart) {
    throw new Error('coverageEndDate nao pode ser menor que coverageStartDate.');
  }

  return {
    absenceDates: [],
    coverageStartDate: normalizedStart,
    coverageEndDate: normalizedEnd,
  };
}

function getRoles(user = {}) {
  const roles = [];

  if (Array.isArray(user.roles)) roles.push(...user.roles);
  if (user.role) roles.push(user.role);
  if (user.profile) roles.push(user.profile);
  if (user.userType) roles.push(user.userType);

  return roles.map((role) => String(role).trim().toLowerCase()).filter(Boolean);
}

function canReviewJustification(user) {
  const roles = getRoles(user);
  return roles.some((role) => ['admin', 'coordenador', 'gestor', 'secretaria'].includes(role));
}

function canOverrideDeadline(user) {
  return canReviewJustification(user);
}

function normalizeNotes(value) {
  return String(value || '').trim();
}

function hasSupportingEvidence(file, notes) {
  return Boolean(file) || normalizeNotes(notes).length > 0;
}

async function resolveAffectedAttendanceEntries({
  schoolId,
  classId,
  studentId,
  coverageStartDate,
  coverageEndDate,
  absenceDates = [],
}) {
  const dateFilter = absenceDates.length > 0
    ? { $in: absenceDates }
    : { $gte: coverageStartDate, $lte: coverageEndDate };

  const attendances = await Attendance.find({
    schoolId,
    classId,
    date: dateFilter,
    'records.studentId': studentId,
    'records.status': 'ABSENT',
  }).sort({ date: 1 });

  const entries = [];

  for (const attendance of attendances) {
    const record = attendance.records.find(
      (item) => String(item.studentId) === String(studentId) && item.status === 'ABSENT'
    );

    if (!record) continue;

    entries.push({
      attendance,
      record,
      date: startOfDay(attendance.date),
      deadlineAt:
        record.justificationDeadlineAt ||
        endOfDay(addDays(attendance.date, DEFAULT_JUSTIFICATION_DEADLINE_DAYS)),
    });
  }

  return entries;
}

async function applyStatusToAttendances(justificationId, entries, status) {
  const absenceState = ATTENDANCE_ABSENCE_STATE_BY_JUSTIFICATION_STATUS[status];
  const now = new Date();

  for (const entry of entries) {
    await Attendance.updateOne(
      { _id: entry.attendance._id },
      {
        $set: {
          'records.$[record].absenceState': absenceState,
          'records.$[record].justificationId': justificationId,
          'records.$[record].justificationDeadlineAt': entry.deadlineAt,
          'records.$[record].justificationUpdatedAt': now,
          'metadata.syncedAt': now,
        },
      },
      {
        arrayFilters: [
          {
            'record.studentId': entry.record.studentId,
            'record.status': 'ABSENT',
          },
        ],
      }
    );
  }
}

function serializeDocument(file) {
  if (!file) return null;

  return {
    fileName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    data: file.buffer,
  };
}

function serializeAttachments(files) {
  return normalizeAttachmentFiles(files).map((file) => {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(String(file.mimetype || '').toLowerCase())) {
      throw createServiceError(
        'Formato de anexo invalido. Use PDF, JPG, JPEG ou PNG.',
        400,
        'invalid_attachment_type'
      );
    }

    return {
      fileName: file.originalname || 'anexo',
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size || 0,
      data: file.buffer,
    };
  });
}

function validateRequestEvidence(documentType, notes, attachments) {
  const normalizedNotes = normalizeNotes(notes);
  const hasAttachment = Array.isArray(attachments) && attachments.length > 0;

  if (DOCUMENT_TYPES_REQUIRING_ATTACHMENT.includes(documentType) && !hasAttachment) {
    throw createServiceError(
      'O tipo de documento informado exige anexo.',
      400,
      'attachment_required_for_document_type'
    );
  }

  if (!hasAttachment && normalizedNotes.length === 0) {
    throw createServiceError(
      'Informe um anexo ou uma observacao para justificar a solicitacao.',
      400,
      'request_evidence_required'
    );
  }
}

function buildRequestPayload(request, extra = {}) {
  const snapshot = toPlainRecord(request);
  if (!snapshot) return null;

  if (Array.isArray(snapshot.attachments)) {
    snapshot.attachments = snapshot.attachments.map((attachment) => ({
      _id: extractId(attachment._id),
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      updatedAt: attachment.updatedAt,
    }));
  }

  return {
    entity: 'absence_justification_request',
    requestId: extractId(snapshot._id),
    schoolId: extractId(snapshot.schoolId),
    studentId: extractId(snapshot.studentId),
    guardianId: extractId(snapshot.guardianId),
    classId: extractId(snapshot.classId),
    status: snapshot.status || null,
    requestedStartDate: snapshot.requestedStartDate || null,
    requestedEndDate: snapshot.requestedEndDate || null,
    approvedDates: snapshot.approvedDates || [],
    studentName: snapshot.studentName || null,
    className: snapshot.className || null,
    audience: extra.audience || ['staff', 'guardian'],
    targetRoles: STAFF_TARGET_ROLES,
    targetGuardianIds: Array.isArray(snapshot.targetGuardianIds)
      ? snapshot.targetGuardianIds.map(extractId).filter(Boolean)
      : [],
    request: snapshot,
    ...extra,
  };
}

function emitRequestEvent(eventName, request, extra = {}) {
  const payload = buildRequestPayload(request, extra);
  if (!eventName || !payload?.schoolId) return;

  const eventPayload = {
    ...payload,
    eventName,
    emittedAt: new Date(),
  };

  appEmitter.emit(eventName, eventPayload);
  setImmediate(() => {
    AppNotificationService.createFromRealtimeEvent(eventName, eventPayload).catch((error) => {
      console.warn('[AppNotification] Falha ao persistir evento de abono', {
        eventName,
        requestId: eventPayload.requestId,
        schoolId: eventPayload.schoolId,
        error: error.message,
      });
    });
  });
}

function requestPopulation() {
  return [
    { path: 'studentId', select: 'fullName photoUrl profilePictureUrl classId' },
    { path: 'classId', select: 'name' },
    { path: 'guardianId', select: 'fullName cpf phoneNumber email' },
    { path: 'reviewedBy', select: 'fullName' },
    { path: 'appliedJustificationId', select: 'status absenceDates attendanceRefs' },
  ];
}

async function reloadRequest(requestId, schoolId) {
  return AbsenceJustificationRequest.findOne({ _id: requestId, schoolId })
    .select('-attachments.data')
    .populate(requestPopulation());
}

async function assertGuardianAccess({ schoolId, accountId, guardianId, studentId }) {
  const link = await GuardianAccessLink.findOne({
    school_id: schoolId,
    guardianAccessAccountId: accountId,
    tutorId: guardianId,
    studentId,
    status: 'active',
  }).select('_id');

  if (!link) {
    throw createServiceError(
      'O responsavel autenticado nao possui acesso ativo para este aluno.',
      403,
      'guardian_access_denied'
    );
  }
}

async function getGuardianStudentIds({ schoolId, accountId, guardianId }) {
  const links = await GuardianAccessLink.find({
    school_id: schoolId,
    guardianAccessAccountId: accountId,
    tutorId: guardianId,
    status: 'active',
  }).select('studentId');

  return [...new Set(links.map((link) => extractId(link.studentId)).filter(Boolean))];
}

async function resolveStudentClassSnapshot(schoolId, studentId) {
  const student = await Student.findOne({
    _id: studentId,
    school_id: schoolId,
  }).select('_id fullName classId');

  if (!student) {
    throw createServiceError('Aluno nao encontrado para esta escola.', 404, 'student_not_found');
  }

  let classId = student.classId;
  let classDoc = classId
    ? await Class.findOne({ _id: classId, school_id: schoolId }).select('_id name')
    : null;

  if (!classDoc) {
    const activeEnrollment = await Enrollment.findOne({
      student: student._id,
      school_id: schoolId,
      status: 'Ativa',
    })
      .sort({ academicYear: -1, createdAt: -1 })
      .populate('class', 'name');

    classDoc = activeEnrollment?.class || null;
    classId = classDoc?._id || null;
  }

  if (!classDoc || !classId) {
    throw createServiceError(
      'Aluno sem turma ativa para registrar solicitacao de abono.',
      400,
      'student_without_active_class'
    );
  }

  return {
    student,
    classDoc,
    classId,
    studentName: student.fullName || 'Aluno',
    className: classDoc.name || 'Turma',
  };
}

async function ensureNoOverlappingActiveRequest({
  schoolId,
  studentId,
  classId,
  requestedStartDate,
  requestedEndDate,
}) {
  const existing = await AbsenceJustificationRequest.findOne({
    schoolId,
    studentId,
    classId,
    status: { $in: ACTIVE_REQUEST_STATUSES },
    requestedStartDate: { $lte: requestedEndDate },
    requestedEndDate: { $gte: requestedStartDate },
  }).select('_id requestedStartDate requestedEndDate status');

  if (existing) {
    throw createServiceError(
      'Ja existe uma solicitacao ativa para este aluno em periodo sobreposto.',
      409,
      'overlapping_absence_justification_request'
    );
  }
}

function filterApplicableEntries(entries = [], appliedJustificationId = null) {
  const currentJustificationId = appliedJustificationId ? String(appliedJustificationId) : null;

  return entries.filter((entry) => {
    const state = String(entry.record.absenceState || 'NONE').toUpperCase();
    const existingJustificationId = entry.record.justificationId
      ? String(entry.record.justificationId)
      : null;

    if (currentJustificationId && existingJustificationId === currentJustificationId) {
      return true;
    }

    return !['PENDING', 'APPROVED'].includes(state);
  });
}

function firstAttachmentAsDocument(request) {
  const attachment = Array.isArray(request.attachments) ? request.attachments[0] : null;
  if (!attachment?.data) return null;

  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    data: attachment.data,
  };
}

async function createOrUpdateAppliedJustificationForRequest(request, entries, reviewerId) {
  const applicableEntries = filterApplicableEntries(entries, request.appliedJustificationId);
  if (applicableEntries.length === 0) {
    return { justification: null, appliedEntries: [] };
  }

  const absenceDates = applicableEntries.map((entry) => entry.date);
  const attendanceRefs = applicableEntries.map((entry) => ({
    attendanceId: entry.attendance._id,
    date: entry.date,
  }));
  const lateEntries = applicableEntries.filter((entry) => entry.deadlineAt < new Date());
  const document = firstAttachmentAsDocument(request);

  let justification = request.appliedJustificationId
    ? await AbsenceJustification.findOne({
        _id: request.appliedJustificationId,
        schoolId: request.schoolId,
      })
    : null;
  const mergedAbsenceDates = normalizeDateList([
    ...(justification?.absenceDates || []),
    ...absenceDates,
  ]);
  const mergedJustificationRefs = new Map(
    [...(justification?.attendanceRefs || []), ...attendanceRefs].map((ref) => [
      String(ref.attendanceId),
      {
        attendanceId: ref.attendanceId,
        date: startOfDay(ref.date),
      },
    ])
  );

  const payload = {
    schoolId: request.schoolId,
    classId: request.classId,
    studentId: request.studentId,
    requestId: request._id,
    documentType: request.documentType || 'OTHER',
    notes: request.notes || '',
    status: 'APPROVED',
    coverageStartDate: mergedAbsenceDates[0],
    coverageEndDate: mergedAbsenceDates[mergedAbsenceDates.length - 1],
    absenceDates: mergedAbsenceDates,
    attendanceRefs: [...mergedJustificationRefs.values()],
    ...(document ? { document } : {}),
    rulesSnapshot: {
      deadlineDays: DEFAULT_JUSTIFICATION_DEADLINE_DAYS,
      deadlineType: 'CALENDAR_DAYS',
      submittedWithinDeadline: lateEntries.length === 0,
      lateOverrideUsed: lateEntries.length > 0,
    },
    submission: {
      submittedById: reviewerId,
      submittedAt: request.createdAt || new Date(),
    },
    review: {
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      decisionNote: request.decisionReason || '',
    },
  };

  if (justification) {
    Object.assign(justification, payload);
    await justification.save();
  } else {
    justification = await AbsenceJustification.create(payload);
  }

  await applyStatusToAttendances(justification._id, applicableEntries, 'APPROVED');

  const appliedDateKeys = new Set([
    ...normalizeDateList(request.appliedDates || []).map(dateKey),
    ...absenceDates.map(dateKey),
  ]);
  request.appliedJustificationId = justification._id;
  request.appliedDates = [...appliedDateKeys].sort().map((key) => startOfDay(key));
  const mergedAttendanceRefs = new Map(
    [...(request.appliedAttendanceRefs || []), ...attendanceRefs].map((ref) => [
      String(ref.attendanceId),
      {
        attendanceId: ref.attendanceId,
        date: startOfDay(ref.date),
      },
    ])
  );
  request.appliedAttendanceRefs = [...mergedAttendanceRefs.values()];
  request.appliedAt = new Date();
  await request.save();

  return { justification, appliedEntries: applicableEntries };
}

exports.create = async (payload, file, currentUser) => {
  const schoolId = payload.schoolId;
  const classId = payload.classId;
  const studentId = payload.studentId;
  const currentUserId = currentUser.id || currentUser._id;

  if (!schoolId || !classId || !studentId) {
    throw new Error('schoolId, classId e studentId sao obrigatorios.');
  }

  const { absenceDates, coverageStartDate, coverageEndDate } = buildCoverageRange(payload);

  const entries = await resolveAffectedAttendanceEntries({
    schoolId,
    classId,
    studentId,
    coverageStartDate,
    coverageEndDate,
    absenceDates,
  });

  if (entries.length === 0) {
    throw new Error('Nenhuma falta encontrada para o aluno no periodo informado.');
  }

  const conflictingEntry = entries.find((entry) =>
    ['PENDING', 'APPROVED'].includes(entry.record.absenceState)
  );

  if (conflictingEntry) {
    throw new Error('Ja existe uma justificativa ativa para pelo menos uma das faltas selecionadas.');
  }

  const lateEntries = entries.filter((entry) => entry.deadlineAt < new Date());
  const overrideAllowed = canOverrideDeadline(currentUser);

  if (lateEntries.length > 0 && !overrideAllowed) {
    throw new Error(
      'Existe falta fora do prazo de abono. Somente perfis administrativos autorizados podem registrar justificativas retroativas.'
    );
  }

  const requestedStatus = String(
    payload.status ||
    (String(payload.approveNow || 'false').toLowerCase() === 'true' ? 'APPROVED' : 'PENDING')
  ).toUpperCase();

  if (!JUSTIFICATION_STATUSES.includes(requestedStatus) || requestedStatus === 'EXPIRED') {
    throw new Error('Status inicial invalido para justificativa. Use PENDING, APPROVED ou REJECTED.');
  }

  if (requestedStatus !== 'PENDING' && !canReviewJustification(currentUser)) {
    throw new Error('Somente perfis administrativos podem aprovar ou recusar justificativas.');
  }

  const document = serializeDocument(file);
  const notes = normalizeNotes(payload.notes);

  if (!hasSupportingEvidence(file, notes)) {
    throw new Error('Informe um documento anexo ou uma observacao para justificar a falta.');
  }

  const justification = await AbsenceJustification.create({
    schoolId,
    classId,
    studentId,
    documentType: payload.documentType || 'OTHER',
    notes,
    status: requestedStatus,
    coverageStartDate,
    coverageEndDate,
    absenceDates: entries.map((entry) => entry.date),
    attendanceRefs: entries.map((entry) => ({
      attendanceId: entry.attendance._id,
      date: entry.date,
    })),
    ...(document ? { document } : {}),
    rulesSnapshot: {
      deadlineDays: DEFAULT_JUSTIFICATION_DEADLINE_DAYS,
      deadlineType: 'CALENDAR_DAYS',
      submittedWithinDeadline: lateEntries.length === 0,
      lateOverrideUsed: lateEntries.length > 0 && overrideAllowed,
    },
    submission: {
      submittedById: currentUserId,
      submittedAt: new Date(),
    },
    review: {
      reviewedById: requestedStatus === 'PENDING' ? null : currentUserId,
      reviewedAt: requestedStatus === 'PENDING' ? null : new Date(),
      decisionNote: payload.reviewNote || '',
    },
  });

  await applyStatusToAttendances(justification._id, entries, requestedStatus);

  return AbsenceJustification.findById(justification._id)
    .select('-document.data')
    .populate('studentId', 'fullName photoUrl')
    .populate('classId', 'name')
    .populate('submission.submittedById', 'fullName')
    .populate('review.reviewedById', 'fullName');
};

exports.list = async (schoolId, filters = {}) => {
  const query = { schoolId };

  if (filters.classId) query.classId = filters.classId;
  if (filters.studentId) query.studentId = filters.studentId;
  if (filters.status) query.status = String(filters.status).toUpperCase();

  if (filters.date) {
    const date = startOfDay(filters.date);
    query.$or = [
      { absenceDates: { $in: [date] } },
      {
        coverageStartDate: { $lte: date },
        coverageEndDate: { $gte: date },
      },
    ];
  }

  return AbsenceJustification.find(query)
    .select('-document.data')
    .sort({ createdAt: -1 })
    .populate('studentId', 'fullName photoUrl')
    .populate('classId', 'name')
    .populate('submission.submittedById', 'fullName')
    .populate('review.reviewedById', 'fullName');
};

exports.getById = async (schoolId, justificationId) => {
  const justification = await AbsenceJustification.findOne({
    _id: justificationId,
    schoolId,
  })
    .select('-document.data')
    .populate('studentId', 'fullName photoUrl')
    .populate('classId', 'name')
    .populate('submission.submittedById', 'fullName')
    .populate('review.reviewedById', 'fullName');

  if (!justification) {
    throw new Error('Justificativa nao encontrada.');
  }

  return justification;
};

exports.getDocument = async (schoolId, justificationId) => {
  const justification = await AbsenceJustification.findOne({
    _id: justificationId,
    schoolId,
  }).select('document studentId coverageStartDate coverageEndDate');

  if (!justification || !justification.document || !justification.document.data) {
    throw new Error('Documento nao encontrado.');
  }

  return justification.document;
};

exports.review = async (schoolId, justificationId, payload, currentUser) => {
  const currentUserId = currentUser.id || currentUser._id;

  if (!canReviewJustification(currentUser)) {
    throw new Error('Somente perfis administrativos podem revisar justificativas.');
  }

  const nextStatus = String(payload.status || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(nextStatus)) {
    throw new Error('Status de revisao invalido. Use APPROVED ou REJECTED.');
  }

  const justification = await AbsenceJustification.findOne({
    _id: justificationId,
    schoolId,
  });

  if (!justification) {
    throw new Error('Justificativa nao encontrada.');
  }

  const entries = await resolveAffectedAttendanceEntries({
    schoolId,
    classId: justification.classId,
    studentId: justification.studentId,
    coverageStartDate: justification.coverageStartDate,
    coverageEndDate: justification.coverageEndDate,
    absenceDates: justification.absenceDates,
  });

  if (entries.length === 0) {
    throw new Error('As faltas vinculadas a esta justificativa nao foram encontradas.');
  }

  justification.status = nextStatus;
  justification.review = {
    reviewedById: currentUserId,
    reviewedAt: new Date(),
    decisionNote: payload.reviewNote || '',
  };

  await justification.save();
  await applyStatusToAttendances(justification._id, entries, nextStatus);

  return AbsenceJustification.findById(justification._id)
    .select('-document.data')
    .populate('studentId', 'fullName photoUrl')
    .populate('classId', 'name')
    .populate('submission.submittedById', 'fullName')
    .populate('review.reviewedById', 'fullName');
};

exports.ABSENCE_JUSTIFICATION_REQUEST_EVENTS = REQUEST_EVENTS;
exports.REQUEST_STATUSES = REQUEST_STATUSES;
exports.normalizeApprovedDatesForRequest = normalizeApprovedDatesForRequest;

exports.createGuardianRequest = async (payload, files, guardianContext) => {
  const schoolId = guardianContext.schoolId || guardianContext.school_id;
  const guardianId = guardianContext.tutorId;
  const accountId = guardianContext.accountId;

  if (!schoolId || !guardianId || !accountId) {
    throw createServiceError('Contexto do responsavel nao informado.', 403, 'guardian_context_required');
  }

  const { requestedStartDate, requestedEndDate } = normalizeRequestRange(payload);
  const documentType = normalizeDocumentType(payload.documentType);
  const notes = normalizeNotes(payload.notes);
  const attachments = serializeAttachments(files);

  validateRequestEvidence(documentType, notes, attachments);

  const snapshot = await resolveStudentClassSnapshot(schoolId, payload.studentId);
  await assertGuardianAccess({
    schoolId,
    accountId,
    guardianId,
    studentId: snapshot.student._id,
  });

  await ensureNoOverlappingActiveRequest({
    schoolId,
    studentId: snapshot.student._id,
    classId: snapshot.classId,
    requestedStartDate,
    requestedEndDate,
  });

  const request = await AbsenceJustificationRequest.create({
    schoolId,
    studentId: snapshot.student._id,
    guardianId,
    guardianAccountId: accountId,
    targetGuardianIds: [guardianId],
    classId: snapshot.classId,
    studentName: snapshot.studentName,
    className: snapshot.className,
    requestedStartDate,
    requestedEndDate,
    approvedDates: [],
    documentType,
    notes,
    attachments,
    status: REQUEST_STATUSES.PENDING,
  });

  const result = await reloadRequest(request._id, schoolId);
  emitRequestEvent(REQUEST_EVENTS.created, result, {
    audience: ['staff'],
    action: 'created_by_guardian',
    toStatus: result.status,
  });

  return result;
};

exports.listSchoolRequests = async (schoolId, filters = {}) => {
  const query = { schoolId };

  if (filters.studentId) query.studentId = filters.studentId;
  if (filters.classId) query.classId = filters.classId;
  if (filters.status) query.status = String(filters.status).trim().toUpperCase();
  if (filters.guardianId) query.guardianId = filters.guardianId;

  if (filters.date) {
    const targetDate = startOfDay(filters.date);
    query.requestedStartDate = { $lte: targetDate };
    query.requestedEndDate = { $gte: targetDate };
  }

  return AbsenceJustificationRequest.find(query)
    .select('-attachments.data')
    .sort({ createdAt: -1 })
    .populate(requestPopulation());
};

exports.listGuardianRequests = async (filters = {}, guardianContext) => {
  const schoolId = guardianContext.schoolId || guardianContext.school_id;
  const guardianId = guardianContext.tutorId;
  const accountId = guardianContext.accountId;
  const allowedStudentIds = await getGuardianStudentIds({ schoolId, accountId, guardianId });

  if (!allowedStudentIds.length) return [];

  const studentId = String(filters.studentId || '').trim();
  if (studentId && !allowedStudentIds.includes(studentId)) {
    throw createServiceError(
      'O responsavel nao possui acesso para o aluno informado.',
      403,
      'guardian_scope_denied'
    );
  }

  const query = {
    schoolId,
    studentId: studentId || { $in: allowedStudentIds },
    targetGuardianIds: guardianId,
  };

  if (filters.status) query.status = String(filters.status).trim().toUpperCase();

  return AbsenceJustificationRequest.find(query)
    .select('-attachments.data')
    .sort({ createdAt: -1 })
    .populate(requestPopulation());
};

exports.getSchoolRequestById = async (schoolId, requestId) => {
  const request = await reloadRequest(requestId, schoolId);
  if (!request) {
    throw createServiceError('Solicitacao de abono nao encontrada.', 404, 'request_not_found');
  }
  return request;
};

exports.getGuardianRequestById = async (requestId, guardianContext) => {
  const schoolId = guardianContext.schoolId || guardianContext.school_id;
  const guardianId = guardianContext.tutorId;
  const accountId = guardianContext.accountId;
  const request = await exports.getSchoolRequestById(schoolId, requestId);

  await assertGuardianAccess({
    schoolId,
    accountId,
    guardianId,
    studentId: extractId(request.studentId),
  });

  const targetGuardianIds = Array.isArray(request.targetGuardianIds)
    ? request.targetGuardianIds.map(extractId)
    : [];

  if (!targetGuardianIds.includes(String(guardianId))) {
    throw createServiceError(
      'A solicitacao nao esta disponivel para este responsavel.',
      403,
      'guardian_request_denied'
    );
  }

  return request;
};

exports.getRequestAttachment = async (schoolId, requestId, attachmentId, options = {}) => {
  const query = { _id: requestId, schoolId };
  if (options.guardianId) query.targetGuardianIds = options.guardianId;

  const request = await AbsenceJustificationRequest.findOne(query).select('attachments');

  if (!request) {
    throw createServiceError('Solicitacao de abono nao encontrada.', 404, 'request_not_found');
  }

  const attachment = request.attachments.id(attachmentId);
  if (!attachment?.data) {
    throw createServiceError('Anexo nao encontrado.', 404, 'attachment_not_found');
  }

  return attachment;
};

async function transitionRequest(request, nextStatus, actorId, payload = {}) {
  const previousStatus = request.status;
  const decisionReason = normalizeNotes(
    payload.decisionReason || payload.reviewReason || payload.reason || payload.notes
  );

  request.status = nextStatus;
  request.decisionReason = decisionReason;
  if (actorId) {
    request.reviewedBy = actorId;
    request.reviewedAt = new Date();
  }

  await request.save();
  const result = await reloadRequest(request._id, request.schoolId);

  emitRequestEvent(REQUEST_EVENTS.updated, result, {
    fromStatus: previousStatus,
    toStatus: nextStatus,
    action: payload.action || 'status_updated',
  });

  const statusEventMap = {
    APPROVED: REQUEST_EVENTS.approved,
    PARTIALLY_APPROVED: REQUEST_EVENTS.partiallyApproved,
    REJECTED: REQUEST_EVENTS.rejected,
    NEEDS_INFORMATION: REQUEST_EVENTS.needsInformation,
    CANCELLED: REQUEST_EVENTS.cancelled,
  };

  if (statusEventMap[nextStatus]) {
    emitRequestEvent(statusEventMap[nextStatus], result, {
      fromStatus: previousStatus,
      toStatus: nextStatus,
      action: payload.action || 'status_updated',
    });
  }

  return result;
}

async function approveRequestWithDates(schoolId, requestId, payload, currentUser, options = {}) {
  if (!canReviewJustification(currentUser)) {
    throw createServiceError('Somente perfis administrativos podem revisar solicitacoes.', 403);
  }

  const request = await AbsenceJustificationRequest.findOne({ _id: requestId, schoolId });
  if (!request) {
    throw createServiceError('Solicitacao de abono nao encontrada.', 404, 'request_not_found');
  }

  if (!REVIEWABLE_REQUEST_STATUSES.includes(request.status)) {
    throw createServiceError('Esta solicitacao nao pode mais ser revisada.', 409, 'request_not_reviewable');
  }

  const approvedDates = normalizeApprovedDatesForRequest(
    payload.approvedDates,
    request.requestedStartDate,
    request.requestedEndDate,
    {
      defaultToFullRange: options.defaultToFullRange === true,
      requireAtLeastOne: true,
    }
  );

  const nextStatus = approvedDatesCoverFullRange(
    approvedDates,
    request.requestedStartDate,
    request.requestedEndDate
  )
    ? REQUEST_STATUSES.APPROVED
    : REQUEST_STATUSES.PARTIALLY_APPROVED;

  request.approvedDates = approvedDates;
  request.decisionReason = normalizeNotes(
    payload.decisionReason || payload.reviewReason || payload.reason || payload.notes
  );
  request.status = nextStatus;
  request.reviewedBy = currentUser.id || currentUser._id;
  request.reviewedAt = new Date();

  const entries = await resolveAffectedAttendanceEntries({
    schoolId,
    classId: request.classId,
    studentId: request.studentId,
    coverageStartDate: approvedDates[0],
    coverageEndDate: approvedDates[approvedDates.length - 1],
    absenceDates: approvedDates,
  });

  await createOrUpdateAppliedJustificationForRequest(
    request,
    entries,
    currentUser.id || currentUser._id
  );

  await request.save();
  const result = await reloadRequest(request._id, schoolId);

  emitRequestEvent(REQUEST_EVENTS.updated, result, {
    toStatus: nextStatus,
    action: nextStatus === REQUEST_STATUSES.APPROVED ? 'approved' : 'partially_approved',
  });
  emitRequestEvent(
    nextStatus === REQUEST_STATUSES.APPROVED
      ? REQUEST_EVENTS.approved
      : REQUEST_EVENTS.partiallyApproved,
    result,
    {
      toStatus: nextStatus,
      action: nextStatus === REQUEST_STATUSES.APPROVED ? 'approved' : 'partially_approved',
    }
  );

  return result;
}

exports.approveRequest = (schoolId, requestId, payload, currentUser) =>
  approveRequestWithDates(schoolId, requestId, payload, currentUser, { defaultToFullRange: true });

exports.partialApproveRequest = (schoolId, requestId, payload, currentUser) =>
  approveRequestWithDates(schoolId, requestId, payload, currentUser, { defaultToFullRange: false });

exports.rejectRequest = async (schoolId, requestId, payload, currentUser) => {
  if (!canReviewJustification(currentUser)) {
    throw createServiceError('Somente perfis administrativos podem revisar solicitacoes.', 403);
  }

  const request = await AbsenceJustificationRequest.findOne({ _id: requestId, schoolId });
  if (!request) {
    throw createServiceError('Solicitacao de abono nao encontrada.', 404, 'request_not_found');
  }

  if (!REVIEWABLE_REQUEST_STATUSES.includes(request.status)) {
    throw createServiceError('Esta solicitacao nao pode mais ser revisada.', 409, 'request_not_reviewable');
  }

  const reason = normalizeNotes(payload.decisionReason || payload.reviewReason || payload.reason);
  if (!reason) {
    throw createServiceError('Informe o motivo da recusa.', 400, 'decision_reason_required');
  }

  request.approvedDates = [];
  return transitionRequest(request, REQUEST_STATUSES.REJECTED, currentUser.id || currentUser._id, {
    ...payload,
    decisionReason: reason,
    action: 'rejected',
  });
};

exports.requestMoreInfo = async (schoolId, requestId, payload, currentUser) => {
  if (!canReviewJustification(currentUser)) {
    throw createServiceError('Somente perfis administrativos podem revisar solicitacoes.', 403);
  }

  const request = await AbsenceJustificationRequest.findOne({ _id: requestId, schoolId });
  if (!request) {
    throw createServiceError('Solicitacao de abono nao encontrada.', 404, 'request_not_found');
  }

  if (!REVIEWABLE_REQUEST_STATUSES.includes(request.status)) {
    throw createServiceError('Esta solicitacao nao pode receber complemento.', 409, 'request_not_reviewable');
  }

  return transitionRequest(request, REQUEST_STATUSES.NEEDS_INFORMATION, currentUser.id || currentUser._id, {
    ...payload,
    action: 'needs_information',
  });
};

exports.cancelGuardianRequest = async (requestId, payload, guardianContext) => {
  const schoolId = guardianContext.schoolId || guardianContext.school_id;
  const guardianId = guardianContext.tutorId;
  const accountId = guardianContext.accountId;
  const request = await AbsenceJustificationRequest.findOne({
    _id: requestId,
    schoolId,
    targetGuardianIds: guardianId,
  });

  if (!request) {
    throw createServiceError('Solicitacao de abono nao encontrada.', 404, 'request_not_found');
  }

  await assertGuardianAccess({
    schoolId,
    accountId,
    guardianId,
    studentId: request.studentId,
  });

  if (![REQUEST_STATUSES.PENDING, REQUEST_STATUSES.UNDER_REVIEW, REQUEST_STATUSES.NEEDS_INFORMATION].includes(request.status)) {
    throw createServiceError('Esta solicitacao nao pode mais ser cancelada pelo responsavel.', 409);
  }

  return transitionRequest(request, REQUEST_STATUSES.CANCELLED, null, {
    ...payload,
    decisionReason: normalizeNotes(payload.cancellationReason || payload.reason || payload.notes),
    action: 'cancelled_by_guardian',
  });
};

exports.complementGuardianRequest = async (requestId, payload, files, guardianContext) => {
  const schoolId = guardianContext.schoolId || guardianContext.school_id;
  const guardianId = guardianContext.tutorId;
  const accountId = guardianContext.accountId;
  const request = await AbsenceJustificationRequest.findOne({
    _id: requestId,
    schoolId,
    targetGuardianIds: guardianId,
  });

  if (!request) {
    throw createServiceError('Solicitacao de abono nao encontrada.', 404, 'request_not_found');
  }

  await assertGuardianAccess({
    schoolId,
    accountId,
    guardianId,
    studentId: request.studentId,
  });

  if (request.status !== REQUEST_STATUSES.NEEDS_INFORMATION) {
    throw createServiceError('Esta solicitacao nao esta aguardando complemento.', 409);
  }

  const notes = normalizeNotes(payload.notes);
  const attachments = serializeAttachments(files);
  validateRequestEvidence(request.documentType, notes, attachments);

  if (notes) {
    request.notes = [request.notes, `Complemento do responsavel: ${notes}`]
      .filter(Boolean)
      .join('\n\n');
  }
  if (attachments.length > 0) {
    request.attachments.push(...attachments);
  }
  request.status = REQUEST_STATUSES.PENDING;
  request.decisionReason = '';
  request.reviewedBy = null;
  request.reviewedAt = null;
  await request.save();

  const result = await reloadRequest(request._id, schoolId);
  emitRequestEvent(REQUEST_EVENTS.updated, result, {
    toStatus: REQUEST_STATUSES.PENDING,
    action: 'complemented_by_guardian',
  });
  return result;
};

exports.applyApprovedRequestCoverageToAttendance = async (attendance, actor = {}) => {
  if (!attendance?.schoolId || !attendance?.classId || !attendance?.date) {
    return [];
  }

  const targetDate = startOfDay(attendance.date);
  const absentRecords = (attendance.records || []).filter(
    (record) => record.status === 'ABSENT'
  );

  if (absentRecords.length === 0) return [];

  const studentIds = absentRecords.map((record) => record.studentId);
  const requests = await AbsenceJustificationRequest.find({
    schoolId: attendance.schoolId,
    classId: attendance.classId,
    studentId: { $in: studentIds },
    status: { $in: [REQUEST_STATUSES.APPROVED, REQUEST_STATUSES.PARTIALLY_APPROVED] },
    approvedDates: targetDate,
  });

  const appliedRequests = [];

  for (const request of requests) {
    const record = absentRecords.find(
      (item) => String(item.studentId) === String(request.studentId)
    );
    if (!record) continue;

    const entry = {
      attendance,
      record,
      date: targetDate,
      deadlineAt:
        record.justificationDeadlineAt ||
        endOfDay(addDays(targetDate, DEFAULT_JUSTIFICATION_DEADLINE_DAYS)),
    };

    const { appliedEntries } = await createOrUpdateAppliedJustificationForRequest(
      request,
      [entry],
      actor.id || actor._id || actor.actorId || attendance.teacherId
    );

    if (appliedEntries.length > 0) {
      const result = await reloadRequest(request._id, request.schoolId);
      appliedRequests.push(result);
      emitRequestEvent(REQUEST_EVENTS.applied, result, {
        audience: ['staff', 'guardian'],
        action: 'applied_after_attendance',
        appliedDate: targetDate,
      });
    }
  }

  return appliedRequests;
};
