const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');

const PlatformAdmin = require('../../api/models/platformAdmin.model');
const activityLibraryService = require('../../api/services/activityLibrary.service');
const platformRouter = require('../../api/routes/platform.routes');

function createQuery(value) {
  return {
    select() { return this; },
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

function createPlatformAuthHarness(role = 'superAdmin') {
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
          name: 'Platform Admin',
          email: 'admin@example.com',
          role,
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

test('DELETE /activity-books/:bookId requires platform token', async () => {
  const bookId = new mongoose.Types.ObjectId();
  let serviceCalled = false;

  const restore = patchMethods([
    {
      target: activityLibraryService,
      key: 'deleteActivityBookPermanently',
      value: async () => {
        serviceCalled = true;
        return {};
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/activity-books/${bookId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteFiles: true }),
      });

      const payload = await response.json();
      assert.equal(response.status, 403);
      assert.match(payload.message, /Nenhum token platform fornecido/i);
      assert.equal(serviceCalled, false);
    });
  } finally {
    restore();
  }
});

test('DELETE /activity-books/:bookId requires superAdmin role', async () => {
  const bookId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness('support');
  let serviceCalled = false;

  const restore = patchMethods([
    {
      target: activityLibraryService,
      key: 'deleteActivityBookPermanently',
      value: async () => {
        serviceCalled = true;
        return {};
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/activity-books/${bookId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deleteFiles: true }),
      });

      const payload = await response.json();
      assert.equal(response.status, 403);
      assert.match(payload.message, /superAdmin/i);
      assert.equal(serviceCalled, false);
    });
  } finally {
    restore();
    auth.restore();
  }
});

test('DELETE /activity-books/:bookId returns deletion summary and forwards payload safely', async () => {
  const bookId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness('superAdmin');
  let capturedPayload = null;

  const restore = patchMethods([
    {
      target: activityLibraryService,
      key: 'deleteActivityBookPermanently',
      value: async (id, payload) => {
        capturedPayload = { id, payload };
        return {
          success: true,
          bookId: String(id),
          deleted: {
            activityBook: true,
            activityPages: 75,
            r2Objects: 76,
          },
          skipped: {
            generatedPrints: true,
          },
          errors: [],
        };
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const body = {
        deleteFiles: true,
        deleteGeneratedPrints: false,
        reason: 'Remocao de caderno de teste',
      };

      const response = await fetch(`${baseUrl}/api/platform/activity-books/${bookId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.deleted.activityPages, 75);
      assert.equal(payload.skipped.generatedPrints, true);
      assert.equal(capturedPayload.id, String(bookId));
      assert.deepEqual(capturedPayload.payload, body);
    });
  } finally {
    restore();
    auth.restore();
  }
});

test('DELETE /activity-books/:bookId returns service validation errors for missing books', async () => {
  const bookId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness('superAdmin');

  const restore = patchMethods([
    {
      target: activityLibraryService,
      key: 'deleteActivityBookPermanently',
      value: async () => {
        const error = new Error('ActivityBook nao encontrado.');
        error.status = 404;
        error.code = 'BOOK_NOT_FOUND';
        throw error;
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/activity-books/${bookId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deleteFiles: true }),
      });

      const payload = await response.json();
      assert.equal(response.status, 404);
      assert.equal(payload.code, 'BOOK_NOT_FOUND');
    });
  } finally {
    restore();
    auth.restore();
  }
});
