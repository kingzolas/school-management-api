const Attendance = require('../models/attendance.model');
const AbsenceJustification = require('../models/absenceJustification.model');

const DEFAULT_JUSTIFICATION_DEADLINE_DAYS = Number(
  process.env.ATTENDANCE_JUSTIFICATION_DEADLINE_DAYS || 3
);

const JUSTIFICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'];
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
