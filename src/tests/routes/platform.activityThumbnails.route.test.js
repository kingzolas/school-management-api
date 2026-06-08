const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');

const PlatformAdmin = require('../../api/models/platformAdmin.model');
const activityThumbnailService = require('../../api/services/activityThumbnail.service');
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

test('generate-thumbnails route requires platform token', async () => {
  const bookId = new mongoose.Types.ObjectId();
  let serviceCalled = false;
  const restore = patchMethods([
    {
      target: activityThumbnailService,
      key: 'generateActivityBookThumbnails',
      value: async () => {
        serviceCalled = true;
        return {};
      },
    },
  ]);

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/activity-books/${bookId}/generate-thumbnails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
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

test('generate-thumbnails route requires superAdmin role', async () => {
  const originalSecret = process.env.PLATFORM_JWT_SECRET;
  process.env.PLATFORM_JWT_SECRET = 'platform-secret-test';

  const bookId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  let serviceCalled = false;

  const restore = patchMethods([
    {
      target: PlatformAdmin,
      key: 'findById',
      value(id) {
        if (String(id) !== String(adminId)) return createQuery(null);
        return createQuery({
          _id: adminId,
          name: 'Operador',
          email: 'operador@example.com',
          role: 'staff',
          isActive: true,
        });
      },
    },
    {
      target: activityThumbnailService,
      key: 'generateActivityBookThumbnails',
      value: async () => {
        serviceCalled = true;
        return {};
      },
    },
  ]);

  try {
    const token = jwt.sign(
      { id: String(adminId), tokenType: 'platform_admin' },
      process.env.PLATFORM_JWT_SECRET
    );

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/platform/activity-books/${bookId}/generate-thumbnails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ force: false }),
      });

      const payload = await response.json();
      assert.equal(response.status, 403);
      assert.match(payload.message, /superAdmin/i);
      assert.equal(serviceCalled, false);
    });
  } finally {
    restore();
    if (originalSecret === undefined) delete process.env.PLATFORM_JWT_SECRET;
    else process.env.PLATFORM_JWT_SECRET = originalSecret;
  }
});
