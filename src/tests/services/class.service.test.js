const test = require('node:test');
const assert = require('node:assert/strict');

const Class = require('../../api/models/class.model');
const ClassService = require('../../api/services/class.service');

const SCHOOL_A = '507f1f77bcf86cd799439011';
const SCHOOL_B = '507f1f77bcf86cd799439012';

function createCorrectIndex() {
  return {
    name: ClassService.UNIQUE_CLASS_INDEX_NAME,
    key: ClassService.UNIQUE_CLASS_INDEX_KEY,
    unique: true,
    partialFilterExpression: {
      status: { $in: ClassService.ACTIVE_CLASS_STATUSES },
    },
    collation: { locale: 'pt', strength: 2 },
  };
}

function createClassData(overrides = {}) {
  return {
    name: 'Maternal B',
    schoolYear: 2026,
    level: 'Educacao Infantil',
    grade: 'Maternal',
    shift: 'Matutino',
    monthlyFee: 0,
    capacity: 30,
    ...overrides,
  };
}

function valuesMatch(left, right) {
  return String(left) === String(right);
}

function matchesQuery(doc, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '_id' && expected?.$ne !== undefined) {
      return !valuesMatch(doc._id, expected.$ne);
    }

    if (key === 'status' && expected?.$in) {
      return expected.$in.includes(doc.status);
    }

    return valuesMatch(doc[key], expected);
  });
}

function createQueryResult(value, onCollation) {
  return {
    select() {
      return this;
    },
    collation(collation) {
      if (onCollation) onCollation(collation);
      return Promise.resolve(value);
    },
  };
}

function installClassHarness(t, existingClasses = [], options = {}) {
  const queries = [];
  const saved = [];
  const createIndexCalls = [];
  const dropIndexCalls = [];
  const collationCalls = [];
  const indexes = options.indexes || [createCorrectIndex()];

  ClassService.resetClassUniquenessIndexCache();

  t.mock.method(Class.collection, 'indexes', async () => indexes);
  t.mock.method(Class.collection, 'createIndex', async (...args) => {
    createIndexCalls.push(args);
    return ClassService.UNIQUE_CLASS_INDEX_NAME;
  });
  t.mock.method(Class.collection, 'dropIndex', async (...args) => {
    dropIndexCalls.push(args);
    throw new Error('dropIndex should not be called by ClassService');
  });
  t.mock.method(Class, 'find', (query) => {
    queries.push(query);
    const docs = existingClasses.filter((doc) => matchesQuery(doc, query));
    return createQueryResult(docs, (collation) => collationCalls.push(collation));
  });
  t.mock.method(Class.prototype, 'save', async function save() {
    if (options.saveError) {
      throw options.saveError;
    }
    saved.push(this);
    return this;
  });

  return {
    queries,
    saved,
    createIndexCalls,
    dropIndexCalls,
    collationCalls,
  };
}

test('class creation allows same name/year/shift in another school', async (t) => {
  const harness = installClassHarness(t, [
    {
      _id: 'class-other-school',
      school_id: SCHOOL_B,
      name: 'Maternal B',
      schoolYear: 2026,
      shift: 'Matutino',
      status: 'Ativa',
    },
  ]);

  const result = await ClassService.createClass(createClassData(), SCHOOL_A);

  assert.equal(result.name, 'Maternal B');
  assert.equal(harness.saved.length, 1);
  assert.equal(String(harness.queries[0].school_id), SCHOOL_A);
});

test('class creation allows same name/year in another shift in same school', async (t) => {
  const harness = installClassHarness(t, [
    {
      _id: 'class-vespertino',
      school_id: SCHOOL_A,
      name: 'Maternal B',
      schoolYear: 2026,
      shift: 'Vespertino',
      status: 'Ativa',
    },
  ]);

  await ClassService.createClass(createClassData({ shift: 'Matutino' }), SCHOOL_A);

  assert.equal(harness.saved.length, 1);
  assert.equal(harness.queries[0].shift, 'Matutino');
});

test('class creation blocks same active name/year/shift in same school', async (t) => {
  installClassHarness(t, [
    {
      _id: 'class-same-context',
      school_id: SCHOOL_A,
      name: 'Maternal B',
      schoolYear: 2026,
      shift: 'Matutino',
      status: 'Planejada',
    },
  ]);

  await assert.rejects(
    () => ClassService.createClass(createClassData(), SCHOOL_A),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Maternal B/);
      assert.match(error.message, /Matutino/);
      return true;
    }
  );
});

test('class creation allows Maternal B when only Maternal A exists', async (t) => {
  const harness = installClassHarness(t, [
    {
      _id: 'class-maternal-a',
      school_id: SCHOOL_A,
      name: 'Maternal A',
      schoolYear: 2026,
      shift: 'Matutino',
      status: 'Ativa',
    },
  ]);

  await ClassService.createClass(createClassData(), SCHOOL_A);

  assert.equal(harness.saved.length, 1);
  assert.notEqual(
    ClassService.normalizeClassNameForComparison('Maternal A'),
    ClassService.normalizeClassNameForComparison('Maternal B')
  );
});

test('class creation allows reuse when previous class is closed or canceled', async (t) => {
  const harness = installClassHarness(t, [
    {
      _id: 'class-closed',
      school_id: SCHOOL_A,
      name: 'Maternal B',
      schoolYear: 2026,
      shift: 'Matutino',
      status: 'Encerrada',
    },
    {
      _id: 'class-canceled',
      school_id: SCHOOL_A,
      name: 'Maternal B',
      schoolYear: 2026,
      shift: 'Matutino',
      status: 'Cancelada',
    },
  ]);

  await ClassService.createClass(createClassData(), SCHOOL_A);

  assert.equal(harness.saved.length, 1);
});

test('manual duplicate validation always scopes by school_id', async (t) => {
  const harness = installClassHarness(t);

  await ClassService.createClass(createClassData(), SCHOOL_A);

  assert.deepEqual(harness.queries[0], {
    school_id: SCHOOL_A,
    schoolYear: 2026,
    shift: 'Matutino',
    status: { $in: ['Planejada', 'Ativa'] },
  });
  assert.deepEqual(harness.collationCalls[0], { locale: 'pt', strength: 2 });
});

test('ClassService warns about legacy indexes but does not drop them automatically', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const harness = installClassHarness(t, [], {
    indexes: [
      createCorrectIndex(),
      {
        name: 'name_1_schoolYear_1',
        key: { name: 1, schoolYear: 1 },
        unique: true,
      },
      {
        name: 'name_1_schoolYear_1_school_id_1',
        key: { name: 1, schoolYear: 1, school_id: 1 },
        unique: true,
      },
    ],
  });

  await ClassService.createClass(createClassData(), SCHOOL_A);

  assert.equal(harness.dropIndexCalls.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /Indices legados/);
});

test('E11000 logs keyPattern and keyValue', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  installClassHarness(t, [], {
    saveError: {
      code: 11000,
      keyPattern: ClassService.UNIQUE_CLASS_INDEX_KEY,
      keyValue: {
        school_id: SCHOOL_A,
        schoolYear: 2026,
        shift: 'Matutino',
        name: 'Maternal B',
      },
    },
  });

  await assert.rejects(() => ClassService.createClass(createClassData(), SCHOOL_A), { statusCode: 409 });

  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0][1].keyPattern, ClassService.UNIQUE_CLASS_INDEX_KEY);
  assert.deepEqual(logs[0][1].keyValue, {
    school_id: SCHOOL_A,
    schoolYear: 2026,
    shift: 'Matutino',
    name: 'Maternal B',
  });
});

test('legacy E11000 does not produce misleading shift-specific duplicate message', async (t) => {
  t.mock.method(console, 'error', () => {});
  installClassHarness(t, [], {
    saveError: {
      code: 11000,
      keyPattern: { name: 1, schoolYear: 1, school_id: 1 },
      keyValue: {
        name: 'Maternal B',
        schoolYear: 2026,
        school_id: SCHOOL_A,
      },
    },
  });

  await assert.rejects(
    () => ClassService.createClass(createClassData({ shift: 'Matutino' }), SCHOOL_A),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /conflito de índice/);
      assert.doesNotMatch(error.message, /no turno Matutino/);
      return true;
    }
  );
});
