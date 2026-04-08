const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const { GuardianAuthService } = require('../../api/services/guardianAuth.service');

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
    TutorModel: {
      find(filter = {}) {
        return createQuery(state.tutors.filter((item) => matchesFilter(item, filter)));
      },
      findOne(filter = {}) {
        return createQuery(state.tutors.find((item) => matchesFilter(item, filter)) || null);
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

  assert.equal(verified.status, 'responsible_verified');
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
  assert.equal(login.school.publicIdentifier, 'escola-a');
  assert.equal(harness.state.accounts.length, 1);
  assert.equal(harness.state.links.length, 1);
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
