const Attendance = require('../models/attendance.model');
const Enrollment = require('../models/enrollment.model');
const mongoose = require('mongoose');

const DEFAULT_JUSTIFICATION_DEADLINE_DAYS = Number(
  process.env.ATTENDANCE_JUSTIFICATION_DEADLINE_DAYS || 3
);

const ABSENCE_STATES = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED'
};

// ============================================================================
// CORREÇÃO: Forçando o fuso local para evitar que a data recue um dia
// ============================================================================
function parseLocalDate(dateValue) {
  if (!dateValue) return new Date();
  
  if (typeof dateValue === 'string') {
    // Separa a data ignorando a hora/fuso UTC (caso venha como ISO)
    const datePart = dateValue.split('T')[0];
    const [year, month, day] = datePart.split('-');
    
    if (year && month && day) {
      // JavaScript usa meses de 0 (Jan) a 11 (Dez)
      return new Date(year, parseInt(month) - 1, day);
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
// ============================================================================

function extractId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
}

function normalizeStatus(status) {
  return String(status || 'PRESENT').toUpperCase() === 'ABSENT' ? 'ABSENT' : 'PRESENT';
}

function buildDeadlineForAbsence(targetDate) {
  return endOfDay(addDays(targetDate, DEFAULT_JUSTIFICATION_DEADLINE_DAYS));
}

async function populateAttendance(attendanceId) {
  return Attendance.findById(attendanceId).populate('records.studentId', 'fullName photoUrl');
}

async function expireOverdueAbsencesForClass(schoolId, classId) {
  const now = new Date();

  await Attendance.updateMany(
    {
      schoolId,
      classId,
      'records.status': 'ABSENT',
      'records.absenceState': { $in: [ABSENCE_STATES.NONE] },
      'records.justificationDeadlineAt': { $lt: now }
    },
    {
      $set: {
        'records.$[record].absenceState': ABSENCE_STATES.EXPIRED,
        'records.$[record].justificationUpdatedAt': now,
        'metadata.syncedAt': now
      }
    },
    {
      arrayFilters: [
        {
          'record.status': 'ABSENT',
          'record.absenceState': { $in: [ABSENCE_STATES.NONE] },
          'record.justificationDeadlineAt': { $lt: now }
        }
      ]
    }
  );
}

exports.createOrUpdate = async (data) => {
  const targetStart = startOfDay(data.date || new Date());
  const targetEnd = endOfDay(data.date || new Date());

  const query = {
    schoolId: data.schoolId,
    classId: data.classId,
    date: { $gte: targetStart, $lte: targetEnd }
  };

  const existingAttendance = await Attendance.findOne(query);
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
      observation: record.observation || ''
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
      syncedAt: new Date()
    }
  };

  const result = await Attendance.findOneAndUpdate(
    query,
    { $set: update },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true
    }
  );

  await expireOverdueAbsencesForClass(data.schoolId, data.classId);

  return populateAttendance(result._id);
};

exports.getDailyList = async (schoolId, classId, dateString) => {
  // CORREÇÃO: Repassando o valor bruto diretamente para a nova função segura
  const targetStart = startOfDay(dateString || new Date());
  const targetEnd = endOfDay(dateString || new Date());

  await expireOverdueAbsencesForClass(schoolId, classId);

  const existingAttendance = await Attendance.findOne({
    schoolId,
    classId,
    date: { $gte: targetStart, $lte: targetEnd }
  }).populate('records.studentId', 'fullName photoUrl');

  if (existingAttendance) {
    return { type: 'saved', data: existingAttendance };
  }

  const enrollments = await Enrollment.find({
    school_id: schoolId,
    class: classId,
    status: 'Ativa'
  }).populate('student', 'fullName photoUrl');

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
        justificationUpdatedAt: null
      }))
  };

  return { type: 'proposed', data: proposedList };
};

exports.getClassHistory = async (schoolId, classId) => {
  await expireOverdueAbsencesForClass(schoolId, classId);

  return Attendance.aggregate([
    {
      $match: {
        schoolId: new mongoose.Types.ObjectId(schoolId),
        classId: new mongoose.Types.ObjectId(classId)
      }
    },
    { $sort: { date: -1 } },
    {
      $project: {
        date: 1,
        updatedAt: 1,
        totalStudents: { $size: '$records' },
        presentCount: {
          $size: {
            $filter: {
              input: '$records',
              as: 'record',
              cond: { $eq: ['$$record.status', 'PRESENT'] }
            }
          }
        },
        absentCount: {
          $size: {
            $filter: {
              input: '$records',
              as: 'record',
              cond: { $eq: ['$$record.status', 'ABSENT'] }
            }
          }
        },
        pendingCount: {
          $size: {
            $filter: {
              input: '$records',
              as: 'record',
              cond: {
                $and: [
                  { $eq: ['$$record.status', 'ABSENT'] },
                  { $eq: ['$$record.absenceState', 'PENDING'] }
                ]
              }
            }
          }
        },
        approvedCount: {
          $size: {
            $filter: {
              input: '$records',
              as: 'record',
              cond: {
                $and: [
                  { $eq: ['$$record.status', 'ABSENT'] },
                  { $eq: ['$$record.absenceState', 'APPROVED'] }
                ]
              }
            }
          }
        },
        rejectedCount: {
          $size: {
            $filter: {
              input: '$records',
              as: 'record',
              cond: {
                $and: [
                  { $eq: ['$$record.status', 'ABSENT'] },
                  { $eq: ['$$record.absenceState', 'REJECTED'] }
                ]
              }
            }
          }
        },
        expiredCount: {
          $size: {
            $filter: {
              input: '$records',
              as: 'record',
              cond: {
                $and: [
                  { $eq: ['$$record.status', 'ABSENT'] },
                  { $eq: ['$$record.absenceState', 'EXPIRED'] }
                ]
              }
            }
          }
        },
        records: 1
      }
    }
  ]);
};

exports.getHistoryByStudent = async (schoolId, studentId) => {
  await Attendance.updateMany(
    {
      schoolId,
      'records.status': 'ABSENT',
      'records.studentId': new mongoose.Types.ObjectId(studentId),
      'records.absenceState': { $in: [ABSENCE_STATES.NONE] },
      'records.justificationDeadlineAt': { $lt: new Date() }
    },
    {
      $set: {
        'records.$[record].absenceState': ABSENCE_STATES.EXPIRED,
        'records.$[record].justificationUpdatedAt': new Date(),
        'metadata.syncedAt': new Date()
      }
    },
    {
      arrayFilters: [
        {
          'record.studentId': new mongoose.Types.ObjectId(studentId),
          'record.status': 'ABSENT',
          'record.absenceState': { $in: [ABSENCE_STATES.NONE] },
          'record.justificationDeadlineAt': { $lt: new Date() }
        }
      ]
    }
  );

  return Attendance.find({
    schoolId,
    'records.studentId': studentId
  }).select('date classId records.$');
};