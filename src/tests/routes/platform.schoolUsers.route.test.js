const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');

const PlatformAdmin = require('../../api/models/platformAdmin.model');
const School = require('../../api/models/school.model');
const User = require('../../api/models/user.model');
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

test('POST /schools/:schoolId/users creates a sanitized school user for platform admins', async () => {
  const schoolId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness();
  let createdPayload = null;

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
      key: 'findOne',
      value(filter = {}) {
        assert.equal(filter.email, 'novo@example.com');
        return createQuery(null);
      },
    },
    {
      target: User,
      key: 'exists',
      value: async () => null,
    },
    {
      target: User,
      key: 'create',
      value: async (payload) => {
        createdPayload = payload;
        return { _id: userId };
      },
    },
    {
      target: User,
      key: 'findById',
      value(id) {
        assert.equal(String(id), String(userId));
        return createQuery({
          _id: userId,
          fullName: createdPayload.fullName,
          email: createdPayload.email,
          roles: createdPayload.roles,
          status: createdPayload.status,
          phoneNumber: createdPayload.phoneNumber,
          createdAt: new Date('2026-06-29T12:00:00.000Z'),
          updatedAt: new Date('2026-06-29T12:00:00.000Z'),
          school_id: schoolId,
        });
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/schools/${schoolId}/users`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Novo Usuario',
          email: ' Novo@Example.com ',
          role: 'secretaria',
          password: 'SenhaForte123',
          status: 'active',
        }),
      });

      const payload = await response.json();
      assert.equal(response.status, 201);
      assert.equal(payload.success, true);
      assert.equal(payload.data.name, 'Novo Usuario');
      assert.equal(payload.data.email, 'novo@example.com');
      assert.equal(payload.data.role, 'Staff');
      assert.deepEqual(payload.data.roles, ['Staff']);
      assert.equal(payload.data.status, 'active');
      assert.equal(payload.data.rawStatus, 'Ativo');
      assert.equal(payload.data.schoolId, String(schoolId));
      assert.equal(payload.data.phone, null);
      assert.equal(Object.prototype.hasOwnProperty.call(payload.data, 'password'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload.data, 'cpf'), false);
      assert.equal(createdPayload.school_id, String(schoolId));
      assert.equal(createdPayload.email, 'novo@example.com');
      assert.equal(createdPayload.roles[0], 'Staff');
      assert.match(createdPayload.cpf, /^platform-/);
      assert.equal(createdPayload.phoneNumber, 'Nao informado');
    });
  } finally {
    restore();
    auth.restore();
  }
});

test('POST /schools/:schoolId/users rejects duplicated email', async () => {
  const schoolId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness();

  const restore = patchMethods([
    {
      target: School,
      key: 'findById',
      value() {
        return createQuery({ _id: schoolId });
      },
    },
    {
      target: User,
      key: 'findOne',
      value() {
        return createQuery({ _id: new mongoose.Types.ObjectId() });
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/schools/${schoolId}/users`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Usuario Duplicado',
          email: 'duplicado@example.com',
          role: 'Admin',
          password: 'SenhaForte123',
        }),
      });

      const payload = await response.json();
      assert.equal(response.status, 409);
      assert.equal(payload.code, 'USER_EMAIL_ALREADY_EXISTS');
    });
  } finally {
    restore();
    auth.restore();
  }
});

test('POST /schools/:schoolId/users validates short password', async () => {
  const schoolId = new mongoose.Types.ObjectId();
  const auth = createPlatformAuthHarness();

  const restore = patchMethods([
    {
      target: School,
      key: 'findById',
      value() {
        return createQuery({ _id: schoolId });
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/schools/${schoolId}/users`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Senha Curta',
          email: 'senha.curta@example.com',
          role: 'Professor',
          password: '1234567',
        }),
      });

      const payload = await response.json();
      assert.equal(response.status, 400);
      assert.equal(payload.code, 'INVALID_PASSWORD');
    });
  } finally {
    restore();
    auth.restore();
  }
});
