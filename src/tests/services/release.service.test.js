const test = require('node:test');
const assert = require('node:assert/strict');

const ReleaseService = require('../../api/services/release.service');

function createChainableModel({ latest = null, upsertResult = null } = {}) {
  return {
    findOne() {
      return {
        sort: async () => latest,
      };
    },
    findOneAndUpdate: async () => upsertResult,
  };
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

test('release service compares semantic versions with and without prefix v', () => {
  assert.equal(ReleaseService.compareVersions('1.9.7', '2.0.1'), -1);
  assert.equal(ReleaseService.compareVersions('2.0.0', '2.0.1'), -1);
  assert.equal(ReleaseService.compareVersions('2.0.1', '2.0.1'), 0);
  assert.equal(ReleaseService.compareVersions('v2.0.1', '2.0.1'), 0);
  assert.equal(ReleaseService.compareVersions('2.0.10', '2.0.2'), 1);
});

test('release service normalizes GitHub payload selecting the installer asset', () => {
  const previousLogger = ReleaseService.logger;
  ReleaseService.logger = createLogger();

  try {
    const normalized = ReleaseService.normalizeGitHubRelease({
      tag_name: 'v2.0.1',
      name: 'Ajuste de contratos',
      body: '',
      html_url: 'https://github.com/kingzolas/academy-hub-releases/releases/tag/v2.0.1',
      published_at: '2026-04-16T13:22:39Z',
      assets: [
        { name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt' },
        {
          name: 'AcademyHub_Setup_v2.0.1.exe',
          browser_download_url: 'https://github.com/kingzolas/academy-hub-releases/releases/download/v2.0.1/AcademyHub_Setup_v2.0.1.exe',
        },
      ],
    });

    assert.equal(normalized.tag, 'v2.0.1');
    assert.equal(normalized.version, '2.0.1');
    assert.equal(normalized.assetName, 'AcademyHub_Setup_v2.0.1.exe');
    assert.equal(
      normalized.downloadUrl,
      'https://github.com/kingzolas/academy-hub-releases/releases/download/v2.0.1/AcademyHub_Setup_v2.0.1.exe'
    );
  } finally {
    ReleaseService.logger = previousLogger;
  }
});

test('release service fetches latest release from GitHub and returns normalized response', async () => {
  const previousHttpClient = ReleaseService.httpClient;
  const previousLogger = ReleaseService.logger;

  ReleaseService.logger = createLogger();
  ReleaseService.httpClient = {
    get: async (url, options) => {
      assert.equal(
        url,
        'https://api.github.com/repos/kingzolas/academy-hub-releases/releases/latest'
      );
      assert.equal(options.headers['User-Agent'], 'AcademyHubReleaseSync/1.0');
      assert.equal(options.headers.Accept, 'application/vnd.github+json');

      return {
        status: 200,
        headers: {},
        data: {
          tag_name: 'v2.0.1',
          name: 'Ajuste de contratos',
          body: '',
          html_url: 'https://github.com/kingzolas/academy-hub-releases/releases/tag/v2.0.1',
          published_at: '2026-04-16T13:22:39Z',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'AcademyHub_Setup_v2.0.1.exe',
              browser_download_url: 'https://github.com/kingzolas/academy-hub-releases/releases/download/v2.0.1/AcademyHub_Setup_v2.0.1.exe',
            },
          ],
        },
      };
    },
  };

  try {
    const latest = await ReleaseService.fetchLatestGitHubRelease();
    assert.equal(latest.tag, 'v2.0.1');
    assert.equal(latest.version, '2.0.1');
    assert.equal(latest.downloadUrl.includes('AcademyHub_Setup_v2.0.1.exe'), true);
  } finally {
    ReleaseService.httpClient = previousHttpClient;
    ReleaseService.logger = previousLogger;
  }
});

test('release service falls back to cached database release when GitHub sync fails', async () => {
  const previousHttpClient = ReleaseService.httpClient;
  const previousReleaseModel = ReleaseService.releaseModel;
  const previousLogger = ReleaseService.logger;

  const cachedRelease = {
    tag: 'v1.8.4',
    name: 'Cached release',
    body: '',
    publishedAt: '2026-03-10T06:11:12.000Z',
    htmlUrl: 'https://github.com/kingzolas/academy-hub-releases/releases/tag/v1.8.4',
    downloadUrl: 'https://github.com/kingzolas/academy-hub-releases/releases/download/v1.8.4/AcademyHub_Setup_v1.8.4.exe',
    toObject() {
      return { ...this };
    },
  };

  ReleaseService.logger = createLogger();
  ReleaseService.releaseModel = createChainableModel({ latest: cachedRelease });
  ReleaseService.httpClient = {
    get: async () => {
      throw new Error('socket hang up');
    },
  };

  try {
    const result = await ReleaseService.getLatestWithDiagnostics();
    assert.equal(result.meta.source, 'database-fallback');
    assert.equal(result.meta.usedFallback, true);
    assert.equal(result.release.tag, 'v1.8.4');
    assert.equal(result.release.version, '1.8.4');
  } finally {
    ReleaseService.httpClient = previousHttpClient;
    ReleaseService.releaseModel = previousReleaseModel;
    ReleaseService.logger = previousLogger;
  }
});
