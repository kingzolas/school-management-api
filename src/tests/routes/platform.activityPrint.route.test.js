const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');

const PlatformAdmin = require('../../api/models/platformAdmin.model');
const School = require('../../api/models/school.model');
const ClassModel = require('../../api/models/class.model');
const Enrollment = require('../../api/models/enrollment.model');
const User = require('../../api/models/user.model');
const activityLibraryService = require('../../api/services/activityLibrary.service');
const activityPrintService = require('../../api/services/activityPrint.service');
const platformRouter = require('../../api/routes/platform.routes');

function createQuery(value) {
  return {
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function patchMethods(entries) {
  const restores = entries.map(({ target, key, value }) => {
    const original = target[key];
    target[key] = value;
    return () => {
      target[key] = original;
    };
  });

  return () => restores.reverse().forEach((restore) => restore());
}

async function withServer(handler) {
  const app = express();
  app.use(express.json());
  app.use('/api/platform', platformRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await handler(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function createPlatformAuthHarness() {
  const originalSecret = process.env.PLATFORM_JWT_SECRET;
  process.env.PLATFORM_JWT_SECRET = 'platform-secret-test';

  const adminId = new mongoose.Types.ObjectId();
  const restore = patchMethods([
    {
      target: PlatformAdmin,
      key: 'findById',
      value(id) {
        if (String(id) !== String(adminId)) return createQuery(null);
        return createQuery({
          _id: adminId,
          name: 'Super Admin',
          email: 'super@example.com',
          role: 'superAdmin',
          isActive: true,
        });
      },
    },
  ]);

  const token = jwt.sign(
    { id: String(adminId), tokenType: 'platform_admin' },
    process.env.PLATFORM_JWT_SECRET
  );

  return {
    token,
    restore() {
      restore();
      if (originalSecret === undefined) delete process.env.PLATFORM_JWT_SECRET;
      else process.env.PLATFORM_JWT_SECRET = originalSecret;
    },
  };
}

test('GET /schools/:schoolId/activity-library returns printable pages visible to the selected school', async () => {
  const schoolId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness();
  let capturedSchoolId = null;

  const restore = patchMethods([
    {
      target: School,
      key: 'findById',
      value(id) {
        return createQuery(String(id) === String(schoolId) ? { _id: schoolId } : null);
      },
    },
    {
      target: activityLibraryService,
      key: 'listSchoolLibraryForPlatform',
      value: async (id) => {
        capturedSchoolId = id;
        return {
          items: [{
            activityPageId: 'page-1',
            bookId: 'book-1',
            bookTitle: 'Caderno',
            pageTitle: 'Pagina 04',
            pageNumber: 4,
            subject: 'Portugues',
            segment: 'Educacao Infantil',
            grade: 'Pre-escola',
            pageType: 'activity',
            printable: true,
            enabled: true,
            printLayout: { mode: 'crop-and-recompose' },
            contentCrop: { xPct: 4, yPct: 18, widthPct: 92, heightPct: 72 },
            footerCrop: null,
            headerOverlay: { xPct: 2, yPct: 2, widthPct: 96, heightPct: 14 },
          }],
          total: 1,
          page: 1,
          limit: 20,
        };
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/schools/${schoolId}/activity-library`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(capturedSchoolId, String(schoolId));
      assert.equal(payload.total, 1);
      assert.equal(payload.items[0].activityPageId, 'page-1');
      assert.equal(payload.items[0].pageType, 'activity');
    });
  } finally {
    restore();
    auth.restore();
  }
});

test('GET /schools/:schoolId/classes returns only classes from the selected school', async () => {
  const schoolId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness();

  const restore = patchMethods([
    {
      target: School,
      key: 'findById',
      value(id) {
        return createQuery(String(id) === String(schoolId) ? { _id: schoolId } : null);
      },
    },
    {
      target: ClassModel,
      key: 'find',
      value(filter = {}) {
        assert.equal(String(filter.school_id), String(schoolId));
        return createQuery([
          {
            _id: new mongoose.Types.ObjectId(),
            name: '3 B',
            grade: '3 Ano',
            shift: 'Matutino',
            schoolYear: 2026,
            status: 'Ativa',
          },
        ]);
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/schools/${schoolId}/classes`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.items.length, 1);
      assert.equal(payload.items[0].name, '3 B');
    });
  } finally {
    restore();
    auth.restore();
  }
});

test('GET /schools/:schoolId/classes/:classId/students returns only active enrollments from the class', async () => {
  const schoolId = new mongoose.Types.ObjectId();
  const classId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness();

  const restore = patchMethods([
    {
      target: School,
      key: 'findById',
      value(id) {
        return createQuery(String(id) === String(schoolId) ? { _id: schoolId } : null);
      },
    },
    {
      target: ClassModel,
      key: 'findOne',
      value(filter = {}) {
        if (String(filter._id) !== String(classId)) return createQuery(null);
        if (String(filter.school_id) !== String(schoolId)) return createQuery(null);
        return createQuery({ _id: classId });
      },
    },
    {
      target: Enrollment,
      key: 'find',
      value(filter = {}) {
        assert.equal(String(filter.school_id), String(schoolId));
        assert.equal(String(filter.class), String(classId));
        assert.equal(filter.status, 'Ativa');
        return createQuery([
          {
            _id: new mongoose.Types.ObjectId(),
            status: 'Ativa',
            student: {
              _id: new mongoose.Types.ObjectId(),
              fullName: 'Milena Brandao Evangelista',
            },
          },
        ]);
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/schools/${schoolId}/classes/${classId}/students`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.items.length, 1);
      assert.equal(payload.items[0].status, 'Ativa');
    });
  } finally {
    restore();
    auth.restore();
  }
});

test('GET /schools/:schoolId/teachers returns active teachers from the selected school', async () => {
  const schoolId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness();

  const restore = patchMethods([
    {
      target: School,
      key: 'findById',
      value(id) {
        return createQuery(String(id) === String(schoolId) ? { _id: schoolId } : null);
      },
    },
    {
      target: User,
      key: 'find',
      value(filter = {}) {
        assert.equal(String(filter.school_id), String(schoolId));
        assert.equal(filter.roles, 'Professor');
        assert.equal(filter.status, 'Ativo');
        return createQuery([
          {
            _id: new mongoose.Types.ObjectId(),
            fullName: 'Edicelia',
            email: 'edicelia@example.com',
            roles: ['Professor'],
          },
        ]);
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/schools/${schoolId}/teachers`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.items.length, 1);
      assert.deepEqual(payload.items[0].roles, ['Professor']);
    });
  } finally {
    restore();
    auth.restore();
  }
});

test('POST /schools/:schoolId/activity-library/:activityPageId/print-test reuses print service and returns downloadUrl', async () => {
  const schoolId = new mongoose.Types.ObjectId();
  const pageId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness();
  let capturedInput = null;

  const restore = patchMethods([
    {
      target: School,
      key: 'findById',
      value(id) {
        return createQuery(String(id) === String(schoolId) ? { _id: schoolId } : null);
      },
    },
    {
      target: activityPrintService,
      key: 'createPlatformPrintTestRun',
      value: async (input) => {
        capturedInput = input;
        return {
          printRun: {
            id: 'print-run-1',
            activityPageId: String(pageId),
            schoolId: String(schoolId),
            classId: 'class-1',
            studentCount: 2,
            status: 'generated',
            generatedPdfKey: `schools/${schoolId}/generated-activities/print-run-1.pdf`,
          },
          downloadUrl: 'https://signed-url.example/print.pdf',
        };
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const body = {
        classId: 'class-1',
        studentIds: ['student-1', 'student-2'],
        teacherId: 'teacher-1',
        printDate: '2026-06-07',
      };

      const response = await fetch(`${baseUrl}/api/platform/schools/${schoolId}/activity-library/${pageId}/print-test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const payload = await response.json();
      assert.equal(response.status, 201);
      assert.equal(payload.printRun.status, 'generated');
      assert.equal(payload.downloadUrl, 'https://signed-url.example/print.pdf');
      assert.equal(capturedInput.schoolId, String(schoolId));
      assert.equal(capturedInput.activityPageId, String(pageId));
      assert.deepEqual(capturedInput.payload, body);
      assert.equal(capturedInput.platformAdmin.role, 'superAdmin');
    });
  } finally {
    restore();
    auth.restore();
  }
});

test('POST /schools/:schoolId/activity-library/:activityPageId/print-test forwards validation errors from the print service', async () => {
  const schoolId = new mongoose.Types.ObjectId();
  const pageId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness();

  const restore = patchMethods([
    {
      target: School,
      key: 'findById',
      value(id) {
        return createQuery(String(id) === String(schoolId) ? { _id: schoolId } : null);
      },
    },
    {
      target: activityPrintService,
      key: 'createPlatformPrintTestRun',
      value: async () => {
        const error = new Error('Turma nao encontrada ou nao pertence a escola selecionada.');
        error.status = 400;
        error.code = 'INVALID_CLASS';
        throw error;
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/schools/${schoolId}/activity-library/${pageId}/print-test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          classId: 'class-1',
          studentIds: ['student-1'],
          printDate: '2026-06-07',
        }),
      });

      const payload = await response.json();
      assert.equal(response.status, 400);
      assert.equal(payload.code, 'INVALID_CLASS');
    });
  } finally {
    restore();
    auth.restore();
  }
});
