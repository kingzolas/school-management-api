const test = require('node:test');
const assert = require('node:assert/strict');

const Attendance = require('../../api/models/attendance.model');
const AbsenceJustification = require('../../api/models/absenceJustification.model');
const absenceJustificationService = require('../../api/services/absenceJustification.service');

function createQuery(value) {
  return {
    select() {
      return this;
    },
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function createAttendanceFind(entries) {
  return function find() {
    return {
      sort() {
        return Promise.resolve(entries);
      },
    };
  };
}

function makeAttendanceEntry({
  attendanceId,
  studentId,
  date,
  deadlineAt,
  absenceState = 'NONE',
}) {
  return {
    _id: attendanceId,
    date,
    records: [
      {
        studentId,
        status: 'ABSENT',
        absenceState,
        justificationDeadlineAt: deadlineAt,
      },
    ],
  };
}

function createFile(name = 'atestado.pdf') {
  return {
    originalname: name,
    mimetype: 'application/pdf',
    size: 32,
    buffer: Buffer.from('fake-pdf'),
  };
}

function withModelStubs(t, overrides = {}) {
  const originalMethods = {
    attendanceFind: Attendance.find,
    attendanceUpdateOne: Attendance.updateOne,
    justificationCreate: AbsenceJustification.create,
    justificationFindById: AbsenceJustification.findById,
  };

  if (overrides.attendanceFind) Attendance.find = overrides.attendanceFind;
  if (overrides.attendanceUpdateOne) Attendance.updateOne = overrides.attendanceUpdateOne;
  if (overrides.justificationCreate) AbsenceJustification.create = overrides.justificationCreate;
  if (overrides.justificationFindById) AbsenceJustification.findById = overrides.justificationFindById;

  t.after(() => {
    Attendance.find = originalMethods.attendanceFind;
    Attendance.updateOne = originalMethods.attendanceUpdateOne;
    AbsenceJustification.create = originalMethods.justificationCreate;
    AbsenceJustification.findById = originalMethods.justificationFindById;
  });
}

test('admin can create late justification without forceLateOverride and using notes only', async (t) => {
  const studentId = 'student-1';
  const lateDate = new Date(Date.now() - (10 * 24 * 60 * 60 * 1000));
  const lateDeadline = new Date(Date.now() - (6 * 24 * 60 * 60 * 1000));
  const attendanceEntries = [
    makeAttendanceEntry({
      attendanceId: 'attendance-1',
      studentId,
      date: lateDate,
      deadlineAt: lateDeadline,
      absenceState: 'EXPIRED',
    }),
  ];

  const updates = [];
  let createdPayload = null;

  withModelStubs(t, {
    attendanceFind: createAttendanceFind(attendanceEntries),
    attendanceUpdateOne: async (...args) => {
      updates.push(args);
      return { acknowledged: true };
    },
    justificationCreate: async (payload) => {
      createdPayload = { _id: 'justification-1', ...payload };
      return createdPayload;
    },
    justificationFindById: () => createQuery(createdPayload),
  });

  const result = await absenceJustificationService.create(
    {
      schoolId: 'school-1',
      classId: 'class-1',
      studentId,
      approveNow: 'true',
      notes: '  Atestado entregue presencialmente na secretaria.  ',
      coverageStartDate: lateDate,
      coverageEndDate: lateDate,
    },
    null,
    {
      id: 'user-1',
      roles: ['Admin'],
    }
  );

  assert.ok(result);
  assert.equal(createdPayload.status, 'APPROVED');
  assert.equal(createdPayload.notes, 'Atestado entregue presencialmente na secretaria.');
  assert.equal(createdPayload.rulesSnapshot.submittedWithinDeadline, false);
  assert.equal(createdPayload.rulesSnapshot.lateOverrideUsed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(createdPayload, 'document'), false);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1].$set['records.$[record].absenceState'], 'APPROVED');
});

test('non-admin cannot bypass late deadline even when forceLateOverride is sent', async (t) => {
  const studentId = 'student-2';
  const lateDate = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000));
  const lateDeadline = new Date(Date.now() - (4 * 24 * 60 * 60 * 1000));

  withModelStubs(t, {
    attendanceFind: createAttendanceFind([
      makeAttendanceEntry({
        attendanceId: 'attendance-2',
        studentId,
        date: lateDate,
        deadlineAt: lateDeadline,
        absenceState: 'EXPIRED',
      }),
    ]),
    attendanceUpdateOne: async () => ({ acknowledged: true }),
    justificationCreate: async () => {
      throw new Error('should not create');
    },
    justificationFindById: () => createQuery(null),
  });

  await assert.rejects(
    absenceJustificationService.create(
      {
        schoolId: 'school-1',
        classId: 'class-1',
        studentId,
        forceLateOverride: 'true',
        notes: 'Tentativa fora do prazo.',
        coverageStartDate: lateDate,
        coverageEndDate: lateDate,
      },
      null,
      {
        id: 'teacher-1',
        roles: ['Professor'],
      }
    ),
    /Somente perfis administrativos autorizados podem registrar justificativas retroativas/
  );
});

test('justification can be created with document only and empty notes', async (t) => {
  const studentId = 'student-3';
  const currentDate = new Date();
  const futureDeadline = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000));
  const file = createFile();
  let createdPayload = null;

  withModelStubs(t, {
    attendanceFind: createAttendanceFind([
      makeAttendanceEntry({
        attendanceId: 'attendance-3',
        studentId,
        date: currentDate,
        deadlineAt: futureDeadline,
      }),
    ]),
    attendanceUpdateOne: async () => ({ acknowledged: true }),
    justificationCreate: async (payload) => {
      createdPayload = { _id: 'justification-3', ...payload };
      return createdPayload;
    },
    justificationFindById: () => createQuery(createdPayload),
  });

  await absenceJustificationService.create(
    {
      schoolId: 'school-1',
      classId: 'class-1',
      studentId,
      approveNow: 'true',
      notes: '   ',
      coverageStartDate: currentDate,
      coverageEndDate: currentDate,
    },
    file,
    {
      id: 'user-3',
      roles: ['Admin'],
    }
  );

  assert.ok(createdPayload.document);
  assert.equal(createdPayload.document.fileName, 'atestado.pdf');
  assert.equal(createdPayload.notes, '');
  assert.equal(createdPayload.rulesSnapshot.submittedWithinDeadline, true);
  assert.equal(createdPayload.rulesSnapshot.lateOverrideUsed, false);
});

test('justification is rejected when neither document nor notes are provided', async (t) => {
  const studentId = 'student-4';
  const currentDate = new Date();
  const futureDeadline = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000));

  withModelStubs(t, {
    attendanceFind: createAttendanceFind([
      makeAttendanceEntry({
        attendanceId: 'attendance-4',
        studentId,
        date: currentDate,
        deadlineAt: futureDeadline,
      }),
    ]),
    attendanceUpdateOne: async () => ({ acknowledged: true }),
    justificationCreate: async () => {
      throw new Error('should not create');
    },
    justificationFindById: () => createQuery(null),
  });

  await assert.rejects(
    absenceJustificationService.create(
      {
        schoolId: 'school-1',
        classId: 'class-1',
        studentId,
        notes: '   ',
        coverageStartDate: currentDate,
        coverageEndDate: currentDate,
      },
      null,
      {
        id: 'user-4',
        roles: ['Admin'],
      }
    ),
    /Informe um documento anexo ou uma observacao/
  );
});

test('approvedDates are normalized, sorted and constrained to requested range', () => {
  const approvedDates = absenceJustificationService.normalizeApprovedDatesForRequest(
    ['2026-04-25', '2026-04-23', '2026-04-23'],
    '2026-04-23',
    '2026-04-28',
    { requireAtLeastOne: true }
  );

  assert.deepEqual(
    approvedDates.map((date) => date.toISOString().slice(0, 10)),
    ['2026-04-23', '2026-04-25']
  );

  assert.throws(
    () => absenceJustificationService.normalizeApprovedDatesForRequest(
      ['2026-04-29'],
      '2026-04-23',
      '2026-04-28',
      { requireAtLeastOne: true }
    ),
    /approvedDates deve conter apenas datas dentro do periodo solicitado/
  );
});

test('medical certificate absence request requires attachment even with notes', async () => {
  await assert.rejects(
    absenceJustificationService.createGuardianRequest(
      {
        studentId: 'student-5',
        requestedStartDate: '2026-04-23',
        requestedEndDate: '2026-04-23',
        documentType: 'MEDICAL_CERTIFICATE',
        notes: 'Aluno possui atestado, mas o arquivo nao foi anexado.',
      },
      null,
      {
        schoolId: 'school-1',
        tutorId: 'guardian-1',
        accountId: 'account-1',
      }
    ),
    /tipo de documento informado exige anexo/
  );
});
