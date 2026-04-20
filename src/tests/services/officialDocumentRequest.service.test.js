const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OfficialDocumentRequestService,
} = require('../../api/services/officialDocumentRequest.service');

function createQuery(value) {
  return {
    populate() {
      return this;
    },
    select() {
      return this;
    },
    sort() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function getPathValues(source, path) {
  const segments = String(path || '').split('.');

  function walk(current, index) {
    if (index >= segments.length) return [current];
    if (current === null || current === undefined) return [];

    const segment = segments[index];

    if (Array.isArray(current)) {
      return current.flatMap((item) => walk(item, index));
    }

    return walk(current[segment], index + 1);
  }

  return walk(source, 0);
}

function sameValue(left, right) {
  return String(left) === String(right);
}

function matchesFilter(document, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') {
      return Array.isArray(condition) && condition.some((item) => matchesFilter(document, item));
    }

    const values = getPathValues(document, key);

    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      if (Object.prototype.hasOwnProperty.call(condition, '$in')) {
        return values.some((value) =>
          condition.$in.some((candidate) => sameValue(value, candidate))
        );
      }
    }

    return values.some((value) => sameValue(value, condition));
  });
}

function createHarness(seed = {}) {
  let requestSequence = 0;
  const state = {
    students: (seed.students || []).map((item) => ({ ...item })),
    requests: (seed.requests || []).map((item) => ({ ...item })),
    documents: (seed.documents || []).map((item) => ({ ...item })),
    emittedEvents: [],
  };

  class FakeOfficialDocumentRequestModel {
    constructor(data = {}) {
      this._id = data._id || `request_${++requestSequence}`;
      Object.assign(this, {
        auditTrail: [],
        targetGuardianIds: [],
      }, data);
    }

    async save() {
      const existingIndex = state.requests.findIndex((item) => sameValue(item._id, this._id));
      if (existingIndex >= 0) {
        state.requests[existingIndex] = this;
      } else {
        state.requests.push(this);
      }

      return this;
    }

    static findOne(filter = {}) {
      return createQuery(state.requests.find((item) => matchesFilter(item, filter)) || null);
    }

    static find(filter = {}) {
      return createQuery(state.requests.filter((item) => matchesFilter(item, filter)));
    }
  }

  const service = new OfficialDocumentRequestService({
    OfficialDocumentRequestModel: FakeOfficialDocumentRequestModel,
    OfficialDocumentModel: {
      async exists(filter = {}) {
        return state.documents.some((item) => matchesFilter(item, filter)) ? { _id: 'doc_1' } : null;
      },
    },
    StudentModel: {
      findOne(filter = {}) {
        return createQuery(state.students.find((item) => matchesFilter(item, filter)) || null);
      },
    },
    GuardianAccessLinkModel: {
      findOne() {
        return createQuery(null);
      },
      find() {
        return createQuery([]);
      },
    },
    eventEmitter: {
      emit(name, payload) {
        state.emittedEvents.push({ name, payload });
      },
    },
    now: () => new Date('2026-04-16T12:00:00.000Z'),
  });

  return { service, state };
}

test('student cannot create own request when under 18', async () => {
  const { service, state } = createHarness({
    students: [
      {
        _id: 'student_minor',
        school_id: 'school_1',
        birthDate: '2010-05-10T00:00:00.000Z',
        tutors: [{ tutorId: 'guardian_1' }],
        financialTutorId: 'guardian_1',
      },
    ],
  });

  await assert.rejects(
    service.createStudentRequest(
      {
        studentId: 'student_minor',
        documentType: 'school_record',
      },
      {
        schoolId: 'school_1',
        studentId: 'student_minor',
      }
    ),
    /Somente alunos maiores de idade/
  );
});

test('school request defaults target guardians from linked tutors and financial tutor', async () => {
  const { service, state } = createHarness({
    students: [
      {
        _id: 'student_1',
        school_id: 'school_1',
        birthDate: '2005-01-10T00:00:00.000Z',
        financialTutorId: 'guardian_financial',
        tutors: [
          { tutorId: 'guardian_1' },
          { tutorId: 'guardian_financial' },
          { tutorId: 'guardian_2' },
        ],
      },
    ],
  });

  const result = await service.createSchoolRequest(
    {
      studentId: 'student_1',
      documentType: 'declaration_of_enrollment',
      purpose: 'Entrega na empresa parceira',
    },
    {
      schoolId: 'school_1',
      actorId: 'user_staff_1',
    }
  );

  assert.equal(result.requesterType, 'school');
  assert.equal(result.documentType, 'enrollment_confirmation');
  assert.equal(state.emittedEvents.length, 1);
  assert.equal(state.emittedEvents[0].name, 'official_document_request_created');
  assert.equal(state.emittedEvents[0].payload.schoolId, 'school_1');
  assert.equal(state.emittedEvents[0].payload.documentType, 'enrollment_confirmation');
  assert.deepEqual(
    result.targetGuardianIds,
    ['guardian_financial', 'guardian_1', 'guardian_2']
  );
  assert.equal(result.status, 'requested');
  assert.equal(result.auditTrail[0].eventType, 'request_created');
});
