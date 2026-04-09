const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const { GuardianAuthService } = require('../../api/services/guardianAuth.service');
const GuardianAccessEvent = require('../../api/models/guardianAccessEvent.model');
const {
  GUARDIAN_ACCESS_EVENT_TYPES,
  GUARDIAN_ACCESS_EVENT_TYPE_VALUES,
} = require('../../api/constants/guardianAccessEventTypes');

function createQuery(value) {
  return {
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(value);
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

      if (Object.prototype.hasOwnProperty.call(condition, '$ne')) {
        return values.every((value) => !sameValue(value, condition.$ne));
      }
    }

    return values.some((value) => sameValue(value, condition));
  });
}

function attachSave(document, nowProvider) {
  if (!document || typeof document !== 'object') return document;

  document.save = async function save() {
    this.updatedAt = nowProvider().toISOString();
    return this;
  };

  return document;
}

function createHarness(seed = {}) {
  let sequence = 0;
  let now = new Date('2026-04-07T10:00:00.000Z');

  const state = {
    schools: (seed.schools || []).map((item) => ({ ...item })),
    students: (seed.students || []).map((item) => ({ ...item })),
    classes: (seed.classes || []).map((item) => ({ ...item })),
    enrollments: (seed.enrollments || []).map((item) => ({ ...item })),
    tutors: (seed.tutors || []).map((item) => ({ ...item })),
    accounts: (seed.accounts || []).map((item) => ({ ...item })),
    links: (seed.links || []).map((item) => ({ ...item })),
    events: (seed.events || []).map((item) => ({ ...item })),
    challenges: (seed.challenges || []).map((item) => ({ ...item })),
  };

  const nowProvider = () => new Date(now);
  const nextId = (prefix) => `${prefix}_${++sequence}`;

  state.accounts.forEach((item) => attachSave(item, nowProvider));
  state.challenges.forEach((item) => attachSave(item, nowProvider));

  const service = new GuardianAuthService({
    SchoolModel: {
      findOne(filter) {
        return createQuery(state.schools.find((item) => matchesFilter(item, filter)) || null);
      },
      findById(id) {
        return createQuery(state.schools.find((item) => sameValue(item._id, id)) || null);
      },
      find(filter = {}) {
        return createQuery(state.schools.filter((item) => matchesFilter(item, filter)));
      },
    },
    StudentModel: {
      find(filter = {}) {
        return createQuery(state.students.filter((item) => matchesFilter(item, filter)));
      },
      findOne(filter = {}) {
        return createQuery(state.students.find((item) => matchesFilter(item, filter)) || null);
      },
    },
    ClassModel: {
      find(filter = {}) {
        return createQuery(state.classes.filter((item) => matchesFilter(item, filter)));
      },
    },
    EnrollmentModel: {
      find(filter = {}) {
        return createQuery(state.enrollments.filter((item) => matchesFilter(item, filter)));
      },
    },
    TutorModel: {
      find(filter = {}) {
        return createQuery(state.tutors.filter((item) => matchesFilter(item, filter)));
      },
      findOne(filter = {}) {
        return createQuery(state.tutors.find((item) => matchesFilter(item, filter)) || null);
      },
      async updateOne(filter = {}, update = {}) {
        const tutor = state.tutors.find((item) => matchesFilter(item, filter)) || null;
        if (!tutor) {
          return { matchedCount: 0, modifiedCount: 0 };
        }

        Object.assign(tutor, update.$set || {});
        return { matchedCount: 1, modifiedCount: 1 };
      },
      aggregate(pipeline = []) {
        const match = pipeline[0]?.$match || {};
        const tutors = state.tutors.filter((item) => matchesFilter(item, match));
        const grouped = new Map();

        tutors.forEach((tutor) => {
          const key = tutor.cpfNormalized;
          if (!key) return;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(tutor);
        });

        return Promise.resolve(
          [...grouped.entries()]
            .filter(([, bucket]) => bucket.length > 1)
            .map(([cpfNormalized, bucket]) => ({
              _id: cpfNormalized,
              count: bucket.length,
              tutorIds: bucket.map((item) => item._id),
            }))
        );
      },
    },
    GuardianAccessAccountModel: {
      findOne(filter = {}) {
        return createQuery(state.accounts.find((item) => matchesFilter(item, filter)) || null);
      },
      find(filter = {}) {
        return Promise.resolve(state.accounts.filter((item) => matchesFilter(item, filter)));
      },
      async create(data) {
        const record = attachSave(
          {
            _id: data._id || nextId('account'),
            createdAt: nowProvider().toISOString(),
            updatedAt: nowProvider().toISOString(),
            ...data,
          },
          nowProvider
        );
        state.accounts.push(record);
        return record;
      },
    },
    GuardianAccessLinkModel: {
      find(filter = {}) {
        return createQuery(state.links.filter((item) => matchesFilter(item, filter)));
      },
      findOne(filter = {}) {
        return createQuery(state.links.find((item) => matchesFilter(item, filter)) || null);
      },
      async findOneAndUpdate(filter = {}, update = {}, options = {}) {
        let record = state.links.find((item) => matchesFilter(item, filter)) || null;

        if (!record && options.upsert) {
          record = {
            _id: nextId('link'),
            createdAt: nowProvider().toISOString(),
            ...filter,
            ...(update.$setOnInsert || {}),
          };
          state.links.push(record);
        }

        if (!record) return null;

        Object.assign(record, update.$setOnInsert || {}, update.$set || {});
        record.updatedAt = nowProvider().toISOString();
        return record;
      },
    },
    GuardianAccessEventModel: {
      async create(data) {
        const record = {
          _id: nextId('event'),
          createdAt: nowProvider().toISOString(),
          ...data,
        };
        state.events.push(record);
        return record;
      },
    },
    GuardianFirstAccessChallengeModel: {
      async create(data) {
        const record = attachSave(
          {
            _id: nextId('challenge'),
            createdAt: nowProvider().toISOString(),
            updatedAt: nowProvider().toISOString(),
            ...data,
          },
          nowProvider
        );
        state.challenges.push(record);
        return record;
      },
      findById(id) {
        return createQuery(state.challenges.find((item) => sameValue(item._id, id)) || null);
      },
    },
    guardianJwtSecret: 'guardian-secret',
    now: nowProvider,
  });

  return {
    service,
    state,
    setNow(value) {
      now = new Date(value);
    },
  };
}

function createBaseSeed() {
  return {
    schools: [
      { _id: 'school-1', name: 'Escola A', publicIdentifier: 'escola-a' },
    ],
    students: [
      {
        _id: 'student-1',
        school_id: 'school-1',
        fullName: 'Ana Souza',
        fullNameNormalized: 'ana souza',
        birthDateKey: '2012-03-10',
        birthDate: '2012-03-10T00:00:00.000Z',
        isActive: true,
        financialTutorId: 'tutor-1',
        tutors: [{ tutorId: 'tutor-1', relationship: 'Mae' }],
      },
    ],
    tutors: [
      {
        _id: 'tutor-1',
        school_id: 'school-1',
        fullName: 'Maria Souza',
        cpf: '123.456.789-09',
        cpfNormalized: '12345678909',
        students: ['student-1'],
      },
    ],
    accounts: [],
    links: [],
    events: [],
    challenges: [],
  };
}

function createMultiChildSeed() {
  const seed = createBaseSeed();
  seed.students.push({
    _id: 'student-2',
    school_id: 'school-1',
    fullName: 'Gabriel Souza',
    fullNameNormalized: 'gabriel souza',
    birthDateKey: '2014-08-20',
    birthDate: '2014-08-20T00:00:00.000Z',
    isActive: true,
    financialTutorId: 'tutor-2',
    tutors: [{ tutorId: 'tutor-2', relationship: 'Mae' }],
  });
  seed.tutors.push({
    _id: 'tutor-2',
    school_id: 'school-1',
    fullName: 'Maria Souza',
    cpf: '123.456.789-09',
    cpfNormalized: '12345678909',
    students: ['student-2'],
  });
  return seed;
}

test('guardian auth first access succeeds end-to-end with PIN creation and recurring login', async () => {
  const harness = createHarness(createBaseSeed());

  const started = await harness.service.startFirstAccess({
    studentFullName: 'Ana Souza',
    birthDate: '2012-03-10',
  });

  assert.equal(started.status, 'challenge_started');
  assert.equal(started.guardians.length, 1);
  assert.equal(started.guardians[0].displayName, 'Maria Souza');
  assert.equal(started.school.publicIdentifier, 'escola-a');

  const verified = await harness.service.verifyResponsible({
    challengeId: started.challengeId,
    optionId: started.guardians[0].optionId,
    cpf: '123.456.789-09',
  });

  assert.equal(verified.status, 'new_account_requires_pin');
  assert.ok(verified.verificationToken);

  const configured = await harness.service.setPin({
    challengeId: started.challengeId,
    verificationToken: verified.verificationToken,
    pin: '246810',
  });

  assert.equal(configured.status, 'pin_configured');
  assert.equal(configured.identifierType, 'cpf');
  assert.equal(configured.identifierMasked, '***.***.***-09');
  assert.equal(Object.prototype.hasOwnProperty.call(configured, 'accountId'), false);

  const login = await harness.service.login({
    identifier: '12345678909',
    pin: '246810',
  });

  assert.ok(login.token);
  assert.equal(login.guardian.identifierMasked, '***.***.***-09');
  assert.equal(login.guardian.linkedStudentsCount, 1);
  assert.equal(login.linkedStudents.length, 1);
  assert.equal(login.defaultStudent.id, 'student-1');
  assert.equal(login.school.publicIdentifier, 'escola-a');
  assert.equal(harness.state.accounts.length, 1);
  assert.equal(harness.state.links.length, 1);
});

test('guardian auth links a second child with the existing PIN instead of creating a new account', async () => {
  const harness = createHarness(createMultiChildSeed());

  const startedFirst = await harness.service.startFirstAccess({
    studentFullName: 'Ana Souza',
    birthDate: '2012-03-10',
  });
  const verifiedFirst = await harness.service.verifyResponsible({
    challengeId: startedFirst.challengeId,
    optionId: startedFirst.guardians[0].optionId,
    cpf: '123.456.789-09',
  });

  await harness.service.setPin({
    challengeId: startedFirst.challengeId,
    verificationToken: verifiedFirst.verificationToken,
    pin: '246810',
  });
  const existingAccountId = harness.state.accounts[0]._id;

  const startedSecond = await harness.service.startFirstAccess({
    studentFullName: 'Gabriel Souza',
    birthDate: '2014-08-20',
  });
  const verifiedSecond = await harness.service.verifyResponsible({
    challengeId: startedSecond.challengeId,
    optionId: startedSecond.guardians[0].optionId,
    cpf: '123.456.789-09',
  });

  assert.equal(verifiedSecond.status, 'existing_account_requires_pin');
  assert.ok(verifiedSecond.verificationToken);

  const linked = await harness.service.linkExistingAccount({
    challengeId: startedSecond.challengeId,
    verificationToken: verifiedSecond.verificationToken,
    pin: '246810',
  });

  assert.equal(linked.status, 'student_linked');
  assert.equal(harness.state.accounts.length, 1);
  assert.equal(harness.state.links.length, 2);
  assert.equal(
    harness.state.links.filter((link) => link.guardianAccessAccountId === existingAccountId)
      .length,
    2
  );
  assert.ok(
    harness.state.events.some(
      (event) =>
        event.eventType === GUARDIAN_ACCESS_EVENT_TYPES.ACCOUNT_LINKED_WITH_EXISTING_PIN
    )
  );
});

test('guardian auth treats student_already_linked as an idempotent success', async () => {
  const seed = createBaseSeed();
  seed.accounts.push({
    _id: 'account-1',
    school_id: 'school-1',
    tutorId: 'tutor-1',
    identifierType: 'cpf',
    identifierNormalized: '12345678909',
    identifierMasked: '***.***.***-09',
    pinHash: await bcrypt.hash('246810', 4),
    status: 'active',
    tokenVersion: 0,
    failedLoginCount: 0,
    blockedUntil: null,
  });
  seed.links.push({
    _id: 'link-1',
    school_id: 'school-1',
    guardianAccessAccountId: 'account-1',
    studentId: 'student-1',
    tutorId: 'tutor-1',
    relationshipSnapshot: 'Mae',
    source: 'first_access',
    status: 'active',
  });

  const harness = createHarness(seed);
  const started = await harness.service.startFirstAccess({
    studentFullName: 'Ana Souza',
    birthDate: '2012-03-10',
  });

  const verified = await harness.service.verifyResponsible({
    challengeId: started.challengeId,
    optionId: started.guardians[0].optionId,
    cpf: '123.456.789-09',
  });

  assert.equal(verified.status, 'student_already_linked');
  assert.equal(verified.identifierMasked, '***.***.***-09');
  assert.equal(harness.state.links.length, 1);
  assert.ok(
    harness.state.events.some(
      (event) => event.eventType === GUARDIAN_ACCESS_EVENT_TYPES.STUDENT_ALREADY_LINKED
    )
  );
});

test('guardian access event model enum stays aligned with guardian auth event constants', () => {
  const eventEnumValues = GuardianAccessEvent.schema.path('eventType').enumValues;

  assert.deepEqual(
    [...eventEnumValues].sort(),
    [...GUARDIAN_ACCESS_EVENT_TYPE_VALUES].sort()
  );
  assert.ok(
    eventEnumValues.includes(
      GUARDIAN_ACCESS_EVENT_TYPES.ACCOUNT_LINKED_WITH_EXISTING_PIN
    )
  );
  assert.ok(
    eventEnumValues.includes(GUARDIAN_ACCESS_EVENT_TYPES.STUDENT_ALREADY_LINKED)
  );
  assert.ok(
    eventEnumValues.includes(GUARDIAN_ACCESS_EVENT_TYPES.ACCOUNT_LINK_FAILED)
  );
});

test('guardian auth keeps the existing-account link flow successful even if audit event persistence fails', async () => {
  const harness = createHarness(createMultiChildSeed());

  const startedFirst = await harness.service.startFirstAccess({
    studentFullName: 'Ana Souza',
    birthDate: '2012-03-10',
  });
  const verifiedFirst = await harness.service.verifyResponsible({
    challengeId: startedFirst.challengeId,
    optionId: startedFirst.guardians[0].optionId,
    cpf: '123.456.789-09',
  });

  await harness.service.setPin({
    challengeId: startedFirst.challengeId,
    verificationToken: verifiedFirst.verificationToken,
    pin: '246810',
  });

  const startedSecond = await harness.service.startFirstAccess({
    studentFullName: 'Gabriel Souza',
    birthDate: '2014-08-20',
  });
  const verifiedSecond = await harness.service.verifyResponsible({
    challengeId: startedSecond.challengeId,
    optionId: startedSecond.guardians[0].optionId,
    cpf: '123.456.789-09',
  });

  harness.service.GuardianAccessEventModel.create = async (data) => {
    if (
      data.eventType ===
      GUARDIAN_ACCESS_EVENT_TYPES.ACCOUNT_LINKED_WITH_EXISTING_PIN
    ) {
      throw new Error('event insert failed');
    }

    const record = {
      _id: `event_fallback_${harness.state.events.length + 1}`,
      createdAt: new Date().toISOString(),
      ...data,
    };
    harness.state.events.push(record);
    return record;
  };

  const linked = await harness.service.linkExistingAccount({
    challengeId: startedSecond.challengeId,
    verificationToken: verifiedSecond.verificationToken,
    pin: '246810',
  });

  assert.equal(linked.status, 'student_linked');
  assert.equal(
    harness.state.links.filter((link) => link.studentId === 'student-2').length,
    1
  );
  assert.equal(
    harness.state.challenges.find((challenge) => challenge._id === startedSecond.challengeId)
      ?.stage,
    'completed'
  );
});

test('guardian auth login returns linked students and default student for multi-child accounts', async () => {
  const seed = createMultiChildSeed();
  seed.accounts.push({
    _id: 'account-1',
    school_id: 'school-1',
    tutorId: 'tutor-1',
    identifierType: 'cpf',
    identifierNormalized: '12345678909',
    identifierMasked: '***.***.***-09',
    pinHash: await bcrypt.hash('246810', 4),
    status: 'active',
    tokenVersion: 0,
    failedLoginCount: 0,
    blockedUntil: null,
  });
  seed.links.push({
    _id: 'link-1',
    school_id: 'school-1',
    guardianAccessAccountId: 'account-1',
    studentId: 'student-1',
    tutorId: 'tutor-1',
    relationshipSnapshot: 'Mae',
    source: 'first_access',
    status: 'active',
  });
  seed.links.push({
    _id: 'link-2',
    school_id: 'school-1',
    guardianAccessAccountId: 'account-1',
    studentId: 'student-2',
    tutorId: 'tutor-2',
    relationshipSnapshot: 'Mae',
    source: 'first_access',
    status: 'active',
  });

  const harness = createHarness(seed);
  const login = await harness.service.login({
    identifier: '12345678909',
    pin: '246810',
  });

  assert.equal(login.guardian.linkedStudentsCount, 2);
  assert.equal(login.linkedStudents.length, 2);
  assert.ok(login.defaultStudent);
  assert.ok(
    ['student-1', 'student-2'].includes(login.defaultStudent.id)
  );
});

test('guardian auth deduplicates duplicate tutor documents with the same CPF for the same student', async () => {
  const seed = createBaseSeed();
  seed.students[0].tutors.push({ tutorId: 'tutor-2', relationship: 'Mae' });
  seed.tutors.push({
    _id: 'tutor-2',
    school_id: 'school-1',
    fullName: 'Maria Souza',
    cpf: '123.456.789-09',
    cpfNormalized: '12345678909',
    students: ['student-1'],
  });

  const harness = createHarness(seed);
  const started = await harness.service.startFirstAccess({
    studentFullName: 'Ana Souza',
    birthDate: '2012-03-10',
  });

  assert.equal(started.guardians.length, 1);
  assert.equal(started.guardians[0].displayName, 'Maria Souza');
});

test('guardian auth rejects when student is not found', async () => {
  const harness = createHarness(createBaseSeed());

  await assert.rejects(
    () =>
      harness.service.startFirstAccess({
        studentFullName: 'Aluno Inexistente',
        birthDate: '2012-03-10',
      }),
    (error) => error.statusCode === 404
  );
});

test('guardian auth asks for school only when student identity is ambiguous across schools', async () => {
  const seed = createBaseSeed();
  seed.schools.push({
    _id: 'school-2',
    name: 'Escola B',
    publicIdentifier: 'escola-b',
  });
  seed.students.push({
    _id: 'student-2',
    school_id: 'school-2',
    fullName: 'Ana Souza',
    fullNameNormalized: 'ana souza',
    birthDateKey: '2012-03-10',
    birthDate: '2012-03-10T00:00:00.000Z',
    isActive: true,
    financialTutorId: 'tutor-2',
    tutors: [{ tutorId: 'tutor-2', relationship: 'Mae' }],
  });
  seed.tutors.push({
    _id: 'tutor-2',
    school_id: 'school-2',
    fullName: 'Marina Souza',
    cpf: '987.654.321-00',
    cpfNormalized: '98765432100',
    students: ['student-2'],
  });

  const harness = createHarness(seed);

  await assert.rejects(
    () =>
      harness.service.startFirstAccess({
        studentFullName: 'Ana Souza',
        birthDate: '2012-03-10',
      }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.payload.status, 'student_ambiguous');
      assert.equal(error.payload.ambiguityType, 'across_schools');
      assert.equal(error.payload.candidateSchools.length, 2);
      return true;
    }
  );
});

test('guardian auth reports ambiguity within a school when duplicated student identity exists in the same school', async () => {
  const seed = createBaseSeed();
  seed.students.push({
    _id: 'student-2',
    school_id: 'school-1',
    fullName: 'Ana Souza',
    fullNameNormalized: 'ana souza',
    birthDateKey: '2012-03-10',
    birthDate: '2012-03-10T00:00:00.000Z',
    isActive: true,
    financialTutorId: 'tutor-1',
    tutors: [{ tutorId: 'tutor-1', relationship: 'Tia' }],
  });

  const harness = createHarness(seed);

  await assert.rejects(
    () =>
      harness.service.startFirstAccess({
        studentFullName: 'Ana Souza',
        birthDate: '2012-03-10',
      }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.payload.status, 'student_ambiguous');
      assert.equal(error.payload.ambiguityType, 'within_school');
      assert.equal(error.payload.candidateSchools, undefined);
      return true;
    }
  );
});

test('guardian auth rejects when no eligible tutor exists', async () => {
  const seed = createBaseSeed();
  seed.tutors[0].cpfNormalized = null;
  seed.tutors[0].cpf = null;

  const harness = createHarness(seed);

  await assert.rejects(
    () =>
      harness.service.startFirstAccess({
        studentFullName: 'Ana Souza',
        birthDate: '2012-03-10',
      }),
    (error) => error.statusCode === 404
  );
});

test('guardian auth rejects invalid CPF in responsible verification', async () => {
  const harness = createHarness(createBaseSeed());
  const started = await harness.service.startFirstAccess({
    studentFullName: 'Ana Souza',
    birthDate: '2012-03-10',
  });

  await assert.rejects(
    () =>
      harness.service.verifyResponsible({
        challengeId: started.challengeId,
        optionId: started.guardians[0].optionId,
        cpf: '11111111111',
      }),
    (error) => error.statusCode === 400
  );
});

test('guardian auth verifies responsible with legacy tutor CPF when cpfNormalized is missing', async () => {
  const seed = createBaseSeed();
  seed.tutors[0].cpfNormalized = null;

  const harness = createHarness(seed);
  const started = await harness.service.startFirstAccess({
    studentFullName: 'Ana Souza',
    birthDate: '2012-03-10',
  });

  const verified = await harness.service.verifyResponsible({
    challengeId: started.challengeId,
    optionId: started.guardians[0].optionId,
    cpf: '123.456.789-09',
  });

  assert.equal(verified.status, 'new_account_requires_pin');
  assert.equal(harness.state.tutors[0].cpfNormalized, '12345678909');
});

test('guardian auth reports tutor CPF missing during responsible verification', async () => {
  const seed = createBaseSeed();
  seed.challenges.push({
    _id: 'challenge-cpf-missing',
    school_id: 'school-1',
    studentId: 'student-1',
    stage: 'awaiting_selection',
    failedCpfAttempts: 0,
    expiresAt: '2026-04-07T12:00:00.000Z',
    candidateGuardians: [
      {
        optionId: 'option-1',
        tutorId: 'tutor-1',
        displayName: 'Maria Souza',
        relationship: 'Mae',
      },
    ],
  });
  seed.tutors[0].cpf = null;
  seed.tutors[0].cpfNormalized = null;

  const harness = createHarness(seed);

  await assert.rejects(
    () =>
      harness.service.verifyResponsible({
        challengeId: 'challenge-cpf-missing',
        optionId: 'option-1',
        cpf: '123.456.789-09',
      }),
    (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.reason, 'tutor_cpf_missing');
      return true;
    }
  );
});

test('guardian auth applies lockout after repeated login failures', async () => {
  const seed = createBaseSeed();
  seed.accounts.push({
    _id: 'account-1',
    school_id: 'school-1',
    tutorId: 'tutor-1',
    identifierType: 'cpf',
    identifierNormalized: '12345678909',
    identifierMasked: '***.***.***-09',
    pinHash: await bcrypt.hash('999999', 4),
    status: 'active',
    tokenVersion: 0,
    failedLoginCount: 0,
    blockedUntil: null,
  });

  const harness = createHarness(seed);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      () =>
        harness.service.login({
          schoolPublicId: 'escola-a',
          identifier: '12345678909',
          pin: '000000',
        }),
      (error) => error.statusCode === 401
    );
  }

  await assert.rejects(
    () =>
      harness.service.login({
        schoolPublicId: 'escola-a',
        identifier: '12345678909',
        pin: '000000',
      }),
    (error) => error.statusCode === 423
  );

  assert.ok(harness.state.accounts[0].blockedUntil);
});

test('guardian auth administrative reset forces account back to pending', async () => {
  const seed = createBaseSeed();
  seed.accounts.push({
    _id: 'account-1',
    school_id: 'school-1',
    tutorId: 'tutor-1',
    identifierType: 'cpf',
    identifierNormalized: '12345678909',
    identifierMasked: '***.***.***-09',
    pinHash: await bcrypt.hash('999999', 4),
    status: 'active',
    tokenVersion: 0,
    failedLoginCount: 1,
    blockedUntil: '2026-04-07T11:00:00.000Z',
  });

  const harness = createHarness(seed);

  const result = await harness.service.resetPin({
    schoolId: 'school-1',
    accountId: 'account-1',
    actor: { id: 'user-1', roles: ['Admin'] },
  });

  assert.equal(result.status, 'pending');
  assert.equal(harness.state.accounts[0].status, 'pending');
  assert.equal(harness.state.accounts[0].pinHash, null);
  assert.equal(harness.state.accounts[0].blockedUntil, null);
});

test('guardian auth isolates recurring login by school public identifier', async () => {
  const seed = createBaseSeed();
  seed.schools.push({
    _id: 'school-2',
    name: 'Escola B',
    publicIdentifier: 'escola-b',
  });
  seed.tutors.push({
    _id: 'tutor-2',
    school_id: 'school-2',
    fullName: 'Maria Souza',
    cpf: '123.456.789-09',
    cpfNormalized: '12345678909',
    students: [],
  });
  seed.accounts.push({
    _id: 'account-1',
    school_id: 'school-1',
    tutorId: 'tutor-1',
    identifierType: 'cpf',
    identifierNormalized: '12345678909',
    identifierMasked: '***.***.***-09',
    pinHash: await bcrypt.hash('111111', 4),
    status: 'active',
    tokenVersion: 0,
    failedLoginCount: 0,
    blockedUntil: null,
  });
  seed.accounts.push({
    _id: 'account-2',
    school_id: 'school-2',
    tutorId: 'tutor-2',
    identifierType: 'cpf',
    identifierNormalized: '12345678909',
    identifierMasked: '***.***.***-09',
    pinHash: await bcrypt.hash('222222', 4),
    status: 'active',
    tokenVersion: 0,
    failedLoginCount: 0,
    blockedUntil: null,
  });

  const harness = createHarness(seed);

  const loginA = await harness.service.login({
    schoolPublicId: 'escola-a',
    identifier: '12345678909',
    pin: '111111',
  });
  assert.ok(loginA.token);

  await assert.rejects(
    () =>
      harness.service.login({
        schoolPublicId: 'escola-b',
        identifier: '12345678909',
        pin: '111111',
      }),
    (error) => error.statusCode === 401
  );
});

test('guardian auth login resolves the correct school automatically when CPF and PIN match a single account', async () => {
  const seed = createBaseSeed();
  seed.schools.push({
    _id: 'school-2',
    name: 'Escola B',
    publicIdentifier: 'escola-b',
  });
  seed.tutors.push({
    _id: 'tutor-2',
    school_id: 'school-2',
    fullName: 'Maria Souza',
    cpf: '123.456.789-09',
    cpfNormalized: '12345678909',
    students: [],
  });
  seed.accounts.push({
    _id: 'account-1',
    school_id: 'school-1',
    tutorId: 'tutor-1',
    identifierType: 'cpf',
    identifierNormalized: '12345678909',
    identifierMasked: '***.***.***-09',
    pinHash: await bcrypt.hash('111111', 4),
    status: 'active',
    tokenVersion: 0,
    failedLoginCount: 0,
    blockedUntil: null,
  });
  seed.accounts.push({
    _id: 'account-2',
    school_id: 'school-2',
    tutorId: 'tutor-2',
    identifierType: 'cpf',
    identifierNormalized: '12345678909',
    identifierMasked: '***.***.***-09',
    pinHash: await bcrypt.hash('222222', 4),
    status: 'active',
    tokenVersion: 0,
    failedLoginCount: 0,
    blockedUntil: null,
  });

  const harness = createHarness(seed);

  const result = await harness.service.login({
    identifier: '12345678909',
    pin: '222222',
  });

  assert.ok(result.token);
  assert.equal(result.school.publicIdentifier, 'escola-b');
});

test('guardian auth login requests school selection only when the same CPF and PIN match more than one school', async () => {
  const seed = createBaseSeed();
  seed.schools.push({
    _id: 'school-2',
    name: 'Escola B',
    publicIdentifier: 'escola-b',
  });
  seed.tutors.push({
    _id: 'tutor-2',
    school_id: 'school-2',
    fullName: 'Maria Souza',
    cpf: '123.456.789-09',
    cpfNormalized: '12345678909',
    students: [],
  });
  seed.accounts.push({
    _id: 'account-1',
    school_id: 'school-1',
    tutorId: 'tutor-1',
    identifierType: 'cpf',
    identifierNormalized: '12345678909',
    identifierMasked: '***.***.***-09',
    pinHash: await bcrypt.hash('111111', 4),
    status: 'active',
    tokenVersion: 0,
    failedLoginCount: 0,
    blockedUntil: null,
  });
  seed.accounts.push({
    _id: 'account-2',
    school_id: 'school-2',
    tutorId: 'tutor-2',
    identifierType: 'cpf',
    identifierNormalized: '12345678909',
    identifierMasked: '***.***.***-09',
    pinHash: await bcrypt.hash('111111', 4),
    status: 'active',
    tokenVersion: 0,
    failedLoginCount: 0,
    blockedUntil: null,
  });

  const harness = createHarness(seed);

  await assert.rejects(
    () =>
      harness.service.login({
        identifier: '12345678909',
        pin: '111111',
      }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.payload.status, 'school_selection_required');
      assert.equal(error.payload.candidateSchools.length, 2);
      return true;
    }
  );
});
