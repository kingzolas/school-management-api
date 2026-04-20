const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const ReleaseService = require('../../api/services/release.service');

async function withServer(run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/releases/latest remains public and is not intercepted by contract auth', async () => {
  const original = ReleaseService.getLatestWithDiagnostics;

  ReleaseService.getLatestWithDiagnostics = async () => ({
    release: {
      tag: 'v2.0.1',
      name: 'Ajuste de contratos',
      body: '',
      publishedAt: '2026-04-16T13:22:39Z',
      htmlUrl: 'https://github.com/kingzolas/academy-hub-releases/releases/tag/v2.0.1',
      downloadUrl: 'https://github.com/kingzolas/academy-hub-releases/releases/download/v2.0.1/AcademyHub_Setup_v2.0.1.exe',
      version: '2.0.1',
    },
    meta: {
      source: 'github',
      usedFallback: false,
    },
  });

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/releases/latest`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.tag, 'v2.0.1');
      assert.equal(response.headers.get('x-release-source'), 'github');
    });
  } finally {
    ReleaseService.getLatestWithDiagnostics = original;
  }
});

test('POST /api/releases/webhook remains public and accepts GitHub payloads', async () => {
  const original = ReleaseService.syncGitHubRelease;
  let receivedPayload = null;

  ReleaseService.syncGitHubRelease = async (payload) => {
    receivedPayload = payload;
    return { tag: payload.release.tag_name };
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/releases/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'published',
          repository: { full_name: 'kingzolas/academy-hub-releases' },
          release: {
            tag_name: 'v2.0.1',
            name: 'Ajuste de contratos',
            assets: [],
            published_at: '2026-04-16T13:22:39Z',
          },
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.message, 'Webhook received successfully');
      assert.equal(receivedPayload.release.tag_name, 'v2.0.1');
    });
  } finally {
    ReleaseService.syncGitHubRelease = original;
  }
});
