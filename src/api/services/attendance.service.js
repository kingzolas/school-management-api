const mongoose = require('mongoose');

const Attendance = require('../models/attendance.model');
const Enrollment = require('../models/enrollment.model');
const {
  createHttpError,
  ensureClassAccess,
  extractId,
  isPrivilegedActor,
} = require('./classAccess.service');
const absenceJustificationService = require('./absenceJustification.service');

const DEFAULT_JUSTIFICATION_DEADLINE_DAYS = Number(
  process.env.ATTENDANCE_JUSTIFICATION_DEADLINE_DAYS || 3
);
const ATTENDANCE_TIME_ZONE =
  process.env.ATTENDANCE_TIME_ZONE || process.env.SCHOOL_TIME_ZONE || 'America/Sao_Paulo';

const ABSENCE_STATES = {
  NONE: 'NONE',
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
      return new Date(year, Number.parseInt(month, 10) - 1, Number.parseInt(day, 10));
    }
  }

  return new Date(dateValue);
}

function startOfDay(dateValue) {
  const date = parseLocalDate(dateValue);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateKey(dateValue) {
  const date = startOfDay(dateValue);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateKeyInTimeZone(dateValue, timeZone = ATTENDANCE_TIME_ZONE) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(dateValue));

    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  } catch (_) {
    return timeZone === 'America/Sao_Paulo'
      ? formatDateKey(dateValue)
      : formatDateKeyInTimeZone(dateValue, 'America/Sao_Paulo');
  }
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

function normalizeStatus(status) {
  return String(status || 'PRESENT').toUpperCase() === 'ABSENT'
    ? 'ABSENT'
    : 'PRESENT';
}

function normalizeAbsenceState(state) {
  const normalized = String(state || ABSENCE_STATES.NONE).toUpperCase();
  return ABSENCE_STATES[normalized] || ABSENCE_STATES.NONE;
}

function compareDateOnly(left, right) {
  const leftKey = formatDateKey(left);
  const rightKey = right ? formatDateKey(right) : formatDateKeyInTimeZone(new Date());

  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return 0;
}

function getAttendancePermissions(actor, targetDate) {
  const comparison = compareDateOnly(targetDate, null);
  const isRetroactive = comparison < 0;
  const isFuture = comparison > 0;
  const hasAdministrativePermission = isPrivilegedActor(actor);
  const canUseDailyFlow = !isRetroactive && !isFuture;
  const canModify = hasAdministrativePermission || canUseDailyFlow;

  let permissionReason = null;
  if (!canModify && isRetroactive) {
    permissionReason = 'Você não tem permissão para alterar chamadas retroativas.';
  } else if (!canModify && isFuture) {
    permissionReason = 'Você não tem permissão para alterar chamadas fora do dia atual.';
  }

  return {
    canCreate: canModify,
    canEdit: canModify,
    isRetroactive,
    isFuture,
    hasAdministrativePermission,
    permissionReason,
  };
}

function roundRate(value) {
  return Math.round(value * 100) / 100;
}

function buildAttendanceSummary(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];

  const presentCount = records.filter(
    (record) => normalizeStatus(record.status) === 'PRESENT'
  ).length;
  const absentCount = records.filter(
    (record) => normalizeStatus(record.status) === 'ABSENT'
  ).length;
  const pendingCount = records.filter(
    (record) =>
      normalizeStatus(record.status) === 'ABSENT' &&
      normalizeAbsenceState(record.absenceState) === ABSENCE_STATES.PENDING
  ).length;
  const approvedCount = records.filter(
    (record) =>
      normalizeStatus(record.status) === 'ABSENT' &&
      normalizeAbsenceState(record.absenceState) === ABSENCE_STATES.APPROVED
  ).length;
  const rejectedCount = records.filter(
    (record) =>
      normalizeStatus(record.status) === 'ABSENT' &&
      normalizeAbsenceState(record.absenceState) === ABSENCE_STATES.REJECTED
  ).length;
  const expiredCount = records.filter(
    (record) =>
      normalizeStatus(record.status) === 'ABSENT' &&
      normalizeAbsenceState(record.absenceState) === ABSENCE_STATES.EXPIRED
  ).length;

  return {
    ...payload,
    totalStudents: records.length,
    presentCount,
    absentCount,
    pendingCount,
    approvedCount,
    rejectedCount,
    expiredCount,
    presenceRate: records.length === 0 ? 0 : roundRate(presentCount / records.length),
  };
}

function buildAttendanceResponse(document) {
  if (!document) return null;

  const payload =
    typeof document.toObject === 'function'
      ? document.toObject({ virtuals: false })
      : { ...document };

  return buildAttendanceSummary(payload);
}

function buildDeadlineForAbsence(targetDate) {
  return endOfDay(addDays(targetDate, DEFAULT_JUSTIFICATION_DEADLINE_DAYS));
}

async function populateAttendance(attendanceId) {
  return Attendance.findById(attendanceId).populate(
    'records.studentId',
    'fullName photoUrl profilePictureUrl'
  );
}

async function expireOverdueAbsencesForClass(schoolId, classId) {
  const now = new Date();

  await Attendance.updateMany(
    {
      schoolId,
      classId,
      'records.status': 'ABSENT',
      'records.absenceState': { $in: [ABSENCE_STATES.NONE] },
      'records.justificationDeadlineAt': { $lt: now },
    },
    {
      $set: {
        'records.$[record].absenceState': ABSENCE_STATES.EXPIRED,
        'records.$[record].justificationUpdatedAt': now,
        'metadata.syncedAt': now,
      },
    },
    {
      arrayFilters: [
        {
          'record.status': 'ABSENT',
          'record.absenceState': { $in: [ABSENCE_STATES.NONE] },
          'record.justificationDeadlineAt': { $lt: now },
        },
      ],
    }
  );
}

function buildRecentRecordLabel(status, absenceState) {
  if (status === 'PRESENT') {
    return 'Presente';
  }

  if (absenceState === ABSENCE_STATES.APPROVED) {
    return 'Falta justificada';
  }

  if (absenceState === ABSENCE_STATES.PENDING) {
    return 'Falta aguardando justificativa';
  }

  if (absenceState === ABSENCE_STATES.REJECTED) {
    return 'Falta com justificativa recusada';
  }

  if (absenceState === ABSENCE_STATES.EXPIRED) {
    return 'Falta sem justificativa';
  }

  return 'Falta';
}

function getStudentRecordFromAttendance(entry, studentId) {
  const targetStudentId = String(studentId);
  const records = Array.isArray(entry?.records) ? entry.records : [];

  return records.find((record) => extractId(record.studentId) === targetStudentId) || null;
}

async function expireOverdueAbsencesByStudent(schoolId, studentId, classId = null) {
  const now = new Date();
  const query = {
    schoolId,
    'records.status': 'ABSENT',
    'records.studentId': new mongoose.Types.ObjectId(studentId),
    'records.absenceState': { $in: [ABSENCE_STATES.NONE] },
    'records.justificationDeadlineAt': { $lt: now },
  };

  if (classId) {
    query.classId = classId;
  }

  await Attendance.updateMany(
    query,
    {
      $set: {
        'records.$[record].absenceState': ABSENCE_STATES.EXPIRED,
        'records.$[record].justificationUpdatedAt': now,
        'metadata.syncedAt': now,
      },
    },
    {
      arrayFilters: [
        {
          'record.studentId': new mongoose.Types.ObjectId(studentId),
          'record.status': 'ABSENT',
          'record.absenceState': { $in: [ABSENCE_STATES.NONE] },
          'record.justificationDeadlineAt': { $lt: now },
        },
      ],
    }
  );
}

async function createOrUpdate(data, actor) {
  await ensureClassAccess(actor, data.schoolId, data.classId);

  const targetStart = startOfDay(data.date || new Date());
  const targetEnd = endOfDay(data.date || new Date());

  const query = {
    schoolId: data.schoolId,
    classId: data.classId,
    date: { $gte: targetStart, $lte: targetEnd },
  };

  const existingAttendance = await Attendance.findOne(query);
  const permissions = getAttendancePermissions(actor, targetStart);

  if (existingAttendance && !permissions.canEdit) {
    throw createHttpError(
      permissions.permissionReason || 'Você não tem permissão para editar esta chamada.',
      403
    );
  }

  if (!existingAttendance && !permissions.canCreate) {
    throw createHttpError(
      permissions.permissionReason || 'Você não tem permissão para criar esta chamada.',
      403
    );
  }

  const existingByStudentId = new Map(
    (existingAttendance?.records || []).map((record) => [String(record.studentId), record])
  );

  const normalizedRecords = (data.records || []).map((record) => {
    const studentId = extractId(record.studentId);
    const status = normalizeStatus(record.status);
    const existingRecord = existingByStudentId.get(String(studentId));

    const merged = {
      studentId,
      status,
      observation: record.observation || '',
    };

    if (status === 'ABSENT') {
      merged.absenceState = existingRecord?.absenceState || ABSENCE_STATES.NONE;
      merged.justificationId = existingRecord?.justificationId || null;
      merged.justificationDeadlineAt =
        existingRecord?.justificationDeadlineAt || buildDeadlineForAbsence(targetStart);
      merged.justificationUpdatedAt = existingRecord?.justificationUpdatedAt || null;
    } else {
      merged.absenceState = ABSENCE_STATES.NONE;
      merged.justificationId = null;
      merged.justificationDeadlineAt = null;
      merged.justificationUpdatedAt = null;
    }

    return merged;
  });

  const update = {
    schoolId: data.schoolId,
    classId: data.classId,
    teacherId: data.teacherId,
    date: targetStart,
    records: normalizedRecords,
    metadata: {
      device: data.metadata?.device || existingAttendance?.metadata?.device || 'mobile',
      syncedAt: new Date(),
    },
  };

  let result;
  try {
    result = await Attendance.findOneAndUpdate(
      query,
      { $set: update },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;

    result = await Attendance.findOneAndUpdate(
      query,
      { $set: update },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!result) {
      throw createHttpError('Ja existe uma chamada para esta turma nesta data.', 409);
    }
  }

  await absenceJustificationService.applyApprovedRequestCoverageToAttendance(result, actor);
  await expireOverdueAbsencesForClass(data.schoolId, data.classId);

  return buildAttendanceResponse(await populateAttendance(result._id));
}

async function getDailyList(schoolId, classId, dateString, actor) {
  await ensureClassAccess(actor, schoolId, classId);

  const targetStart = startOfDay(dateString || new Date());
  const targetEnd = endOfDay(dateString || new Date());

  await expireOverdueAbsencesForClass(schoolId, classId);

  const existingAttendance = await Attendance.findOne({
    schoolId,
    classId,
    date: { $gte: targetStart, $lte: targetEnd },
  }).populate('records.studentId', 'fullName photoUrl profilePictureUrl');

  if (existingAttendance) {
    const permissions = getAttendancePermissions(actor, targetStart);
    return {
      type: 'saved',
      date: formatDateKey(targetStart),
      ...permissions,
      canCreate: false,
      data: buildAttendanceResponse(existingAttendance),
    };
  }

  const enrollments = await Enrollment.find({
    school_id: schoolId,
    class: classId,
    status: 'Ativa',
  }).populate('student', 'fullName photoUrl profilePictureUrl');

  const proposedList = {
    schoolId,
    classId,
    date: targetStart,
    records: enrollments
      .filter((enrollment) => enrollment.student)
      .map((enrollment) => ({
        studentId: enrollment.student,
        status: 'PRESENT',
        observation: '',
        absenceState: ABSENCE_STATES.NONE,
        justificationId: null,
        justificationDeadlineAt: null,
        justificationUpdatedAt: null,
      })),
  };

  const permissions = getAttendancePermissions(actor, targetStart);
  return {
    type: 'proposed',
    date: formatDateKey(targetStart),
    ...permissions,
    canEdit: false,
    data: buildAttendanceSummary(proposedList),
  };
}

async function getClassHistory(schoolId, classId, actor) {
  await ensureClassAccess(actor, schoolId, classId);

  await expireOverdueAbsencesForClass(schoolId, classId);

  const history = await Attendance.find({
    schoolId: new mongoose.Types.ObjectId(schoolId),
    classId: new mongoose.Types.ObjectId(classId),
  })
    .sort({ date: -1, updatedAt: -1 })
    .populate('records.studentId', 'fullName photoUrl profilePictureUrl');

  return history.map((entry) => buildAttendanceResponse(entry));
}

async function getHistoryByStudent(schoolId, studentId, options = {}) {
  const { classId = null, actor = null } = options;

  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    throw createHttpError('Aluno invalido.', 400);
  }

  if (classId) {
    await ensureClassAccess(actor, schoolId, classId);
  }

  await expireOverdueAbsencesByStudent(schoolId, studentId, classId);

  const query = {
    schoolId,
    'records.studentId': new mongoose.Types.ObjectId(studentId),
  };

  if (classId) {
    query.classId = classId;
  }

  return Attendance.find(query)
    .sort({ date: -1, updatedAt: -1 })
    .select('date classId records.$ metadata updatedAt');
}

async function getStudentRecentHistorySummary({
  schoolId,
  classId,
  studentId,
  actor,
  limit = 7,
  skipAccessCheck = false,
}) {
  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    throw createHttpError('Aluno invalido.', 400);
  }

  if (!skipAccessCheck) {
    await ensureClassAccess(actor, schoolId, classId);
  }

  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 7, 15));

  await expireOverdueAbsencesByStudent(schoolId, studentId, classId);

  const history = await Attendance.find({
    schoolId,
    classId,
    'records.studentId': new mongoose.Types.ObjectId(studentId),
  })
    .sort({ date: -1, updatedAt: -1 })
    .limit(normalizedLimit)
    .select('date records metadata updatedAt')
    .lean();

  const records = history
    .map((entry) => {
      const studentRecord = getStudentRecordFromAttendance(entry, studentId);
      if (!studentRecord) return null;

      const status = normalizeStatus(studentRecord.status);
      const absenceState =
        status === 'ABSENT'
          ? normalizeAbsenceState(studentRecord.absenceState)
          : ABSENCE_STATES.NONE;

      return {
        date: entry.date,
        status,
        absenceState,
        label: buildRecentRecordLabel(status, absenceState),
        observation: studentRecord.observation || '',
        updatedAt: studentRecord.justificationUpdatedAt || entry.updatedAt || entry.date,
      };
    })
    .filter(Boolean);

  const presentCount = records.filter((record) => record.status === 'PRESENT').length;
  const absentCount = records.filter((record) => record.status === 'ABSENT').length;
  const justifiedAbsences = records.filter(
    (record) =>
      record.status === 'ABSENT' && record.absenceState === ABSENCE_STATES.APPROVED
  ).length;
  const pendingJustifications = records.filter(
    (record) =>
      record.status === 'ABSENT' && record.absenceState === ABSENCE_STATES.PENDING
  ).length;
  const rejectedJustifications = records.filter(
    (record) =>
      record.status === 'ABSENT' && record.absenceState === ABSENCE_STATES.REJECTED
  ).length;
  const expiredJustifications = records.filter(
    (record) =>
      record.status === 'ABSENT' && record.absenceState === ABSENCE_STATES.EXPIRED
  ).length;

  return {
    window: {
      type: 'last_records',
      requestedSize: normalizedLimit,
      returnedRecords: records.length,
    },
    summary: {
      totalRecords: records.length,
      presentCount,
      absentCount,
      justifiedAbsences,
      pendingJustifications,
      rejectedJustifications,
      expiredJustifications,
      presenceRate: records.length === 0 ? 0 : roundRate(presentCount / records.length),
      lastRecordedAt: records[0]?.date || null,
    },
    records,
  };
}

module.exports = {
  ABSENCE_STATES,
  buildAttendanceResponse,
  buildAttendanceSummary,
  createOrUpdate,
  formatDateKey,
  getAttendancePermissions,
  getDailyList,
  getClassHistory,
  getHistoryByStudent,
  getStudentRecentHistorySummary,
};
