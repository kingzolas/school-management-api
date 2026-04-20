const axios = require('axios');

const Release = require('../models/release.model');

const DEFAULT_GITHUB_OWNER = 'kingzolas';
const DEFAULT_GITHUB_REPO = 'academy-hub-releases';
const DEFAULT_USER_AGENT = 'AcademyHubReleaseSync/1.0';
const DEFAULT_ASSET_PATTERN = '^AcademyHub_Setup_.*\\.exe$';
const RELEASE_ACTIONS = new Set(['published', 'released', 'edited']);

class ReleaseService {
  constructor({
    releaseModel = Release,
    httpClient = axios,
    logger = console,
  } = {}) {
    this.releaseModel = releaseModel;
    this.httpClient = httpClient;
    this.logger = logger;
  }

  getGitHubConfig() {
    return {
      owner: (process.env.GITHUB_RELEASE_OWNER || DEFAULT_GITHUB_OWNER).trim(),
      repo: (process.env.GITHUB_RELEASE_REPO || DEFAULT_GITHUB_REPO).trim(),
      token: (process.env.GITHUB_RELEASES_TOKEN || process.env.GITHUB_TOKEN || '').trim() || null,
      userAgent: (process.env.GITHUB_RELEASES_USER_AGENT || DEFAULT_USER_AGENT).trim(),
      assetPattern: this.buildAssetRegex(process.env.GITHUB_RELEASE_ASSET_REGEX || DEFAULT_ASSET_PATTERN),
    };
  }

  buildAssetRegex(pattern) {
    try {
      return new RegExp(pattern, 'i');
    } catch (error) {
      this.logger.warn(
        `[ReleaseService] Regex de asset invalida (${pattern}). Usando fallback padrao.`
      );
      return new RegExp(DEFAULT_ASSET_PATTERN, 'i');
    }
  }

  normalizeVersion(version) {
    if (version == null) return null;

    const normalized = String(version)
      .trim()
      .replace(/^[vV]/, '')
      .split(/[+-]/)[0];

    if (!normalized) return null;
    return normalized;
  }

  parseVersion(version) {
    const normalized = this.normalizeVersion(version);
    if (!normalized || !/^\d+(?:\.\d+)*$/.test(normalized)) {
      return null;
    }

    return normalized.split('.').map((segment) => Number(segment));
  }

  compareVersions(leftVersion, rightVersion) {
    const left = this.parseVersion(leftVersion);
    const right = this.parseVersion(rightVersion);

    if (!left || !right) {
      throw new Error(
        `Nao foi possivel comparar as versoes '${leftVersion}' e '${rightVersion}'.`
      );
    }

    const maxLength = Math.max(left.length, right.length);
    for (let index = 0; index < maxLength; index += 1) {
      const leftPart = left[index] ?? 0;
      const rightPart = right[index] ?? 0;

      if (leftPart > rightPart) return 1;
      if (leftPart < rightPart) return -1;
    }

    return 0;
  }

  buildGitHubHeaders(config = this.getGitHubConfig()) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': config.userAgent,
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (config.token) {
      headers.Authorization = `Bearer ${config.token}`;
    }

    return headers;
  }

  getExpectedRepositoryFullName(config = this.getGitHubConfig()) {
    return `${config.owner}/${config.repo}`;
  }

  findInstallerAsset(assets, assetPattern) {
    if (!Array.isArray(assets) || assets.length === 0) {
      return null;
    }

    const normalizedAssets = assets.filter((asset) => asset && typeof asset.name === 'string');
    return (
      normalizedAssets.find((asset) => assetPattern.test(asset.name))
      || normalizedAssets.find((asset) => asset.name.toLowerCase().endsWith('.exe'))
      || null
    );
  }

  createGitHubError(message, {
    code = 'GITHUB_RELEASE_SYNC_FAILED',
    statusCode = 502,
    details = null,
    responseStatus = null,
  } = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    error.details = details;
    error.responseStatus = responseStatus;
    return error;
  }

  normalizeGitHubRelease(release, config = this.getGitHubConfig()) {
    if (!release || typeof release !== 'object') {
      throw this.createGitHubError('Payload de release do GitHub veio vazio ou invalido.', {
        code: 'GITHUB_RELEASE_INVALID_PAYLOAD',
        statusCode: 502,
      });
    }

    const tag = String(release.tag_name || release.tag || '').trim();
    if (!tag) {
      throw this.createGitHubError('GitHub retornou uma release sem tag_name.', {
        code: 'GITHUB_RELEASE_INVALID_TAG',
        statusCode: 502,
      });
    }

    const publishedAt = release.published_at || release.created_at || null;
    if (!publishedAt) {
      throw this.createGitHubError(`A release ${tag} nao possui published_at.`, {
        code: 'GITHUB_RELEASE_INVALID_PUBLISHED_AT',
        statusCode: 502,
      });
    }

    const installerAsset = this.findInstallerAsset(release.assets, config.assetPattern);

    return {
      tag,
      version: this.normalizeVersion(tag),
      name: release.name || tag,
      body: typeof release.body === 'string' ? release.body : '',
      publishedAt,
      htmlUrl: release.html_url || null,
      downloadUrl: installerAsset?.browser_download_url || null,
      assetName: installerAsset?.name || null,
      draft: Boolean(release.draft),
      prerelease: Boolean(release.prerelease),
    };
  }

  toReleaseResponse(release) {
    if (!release) return null;

    const data = typeof release.toObject === 'function'
      ? release.toObject()
      : { ...release };

    return {
      ...data,
      version: this.normalizeVersion(data.tag),
    };
  }

  async upsertRelease(normalizedRelease) {
    return this.releaseModel.findOneAndUpdate(
      { tag: normalizedRelease.tag },
      {
        tag: normalizedRelease.tag,
        name: normalizedRelease.name,
        body: normalizedRelease.body,
        publishedAt: normalizedRelease.publishedAt,
        htmlUrl: normalizedRelease.htmlUrl,
        downloadUrl: normalizedRelease.downloadUrl,
      },
      { upsert: true, new: true }
    );
  }

  async fetchLatestGitHubRelease() {
    const config = this.getGitHubConfig();
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/releases/latest`;

    let response;
    try {
      response = await this.httpClient.get(url, {
        headers: this.buildGitHubHeaders(config),
        timeout: 15000,
        validateStatus: () => true,
      });
    } catch (error) {
      throw this.createGitHubError(
        `Falha de rede ao consultar o GitHub Releases de ${config.owner}/${config.repo}: ${error.message}`,
        {
          code: 'GITHUB_RELEASE_NETWORK_ERROR',
          statusCode: 502,
          details: error.message,
        }
      );
    }

    if (response.status === 403 && response.headers?.['x-ratelimit-remaining'] === '0') {
      throw this.createGitHubError(
        `GitHub rate limit atingido ao consultar ${config.owner}/${config.repo}.`,
        {
          code: 'GITHUB_RELEASE_RATE_LIMIT',
          statusCode: 503,
          details: response.data?.message || null,
          responseStatus: response.status,
        }
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.createGitHubError(
        `GitHub Releases respondeu com status ${response.status} para ${config.owner}/${config.repo}.`,
        {
          code: 'GITHUB_RELEASE_HTTP_ERROR',
          statusCode: 502,
          details: response.data?.message || null,
          responseStatus: response.status,
        }
      );
    }

    const normalizedRelease = this.normalizeGitHubRelease(response.data, config);
    if (normalizedRelease.draft || normalizedRelease.prerelease) {
      throw this.createGitHubError(
        `GitHub retornou uma release nao publica para ${config.owner}/${config.repo}.`,
        {
          code: 'GITHUB_RELEASE_NOT_PUBLIC',
          statusCode: 502,
          details: {
            draft: normalizedRelease.draft,
            prerelease: normalizedRelease.prerelease,
          },
          responseStatus: response.status,
        }
      );
    }

    return normalizedRelease;
  }

  logGitHubFailure(error, cachedRelease = null) {
    const fallbackTag = cachedRelease?.tag || 'none';
    this.logger.error(
      `[ReleaseService] Falha ao sincronizar ultima release do GitHub. ` +
      `code=${error.code || 'UNKNOWN'} status=${error.responseStatus || error.statusCode || 'N/A'} ` +
      `fallback=${fallbackTag} message=${error.message}`
    );
  }

  isExpectedWebhookRepository(repository, config = this.getGitHubConfig()) {
    if (!repository?.full_name) return true;
    return repository.full_name.toLowerCase() === this.getExpectedRepositoryFullName(config).toLowerCase();
  }

  // Funcao que o Controller vai chamar quando o GitHub disparar o Webhook
  async syncGitHubRelease(payload) {
    const { action, release, repository } = payload || {};
    const config = this.getGitHubConfig();

    if (!RELEASE_ACTIONS.has(action)) {
      return null;
    }

    if (!this.isExpectedWebhookRepository(repository, config)) {
      this.logger.warn(
        `[ReleaseService] Webhook ignorado: repositorio inesperado (${repository?.full_name}). ` +
        `Esperado=${this.getExpectedRepositoryFullName(config)}`
      );
      return null;
    }

    if (!release) return null;

    const normalizedRelease = this.normalizeGitHubRelease(release, config);
    if (normalizedRelease.draft || normalizedRelease.prerelease) {
      this.logger.info(
        `[ReleaseService] Webhook da release ${normalizedRelease.tag} ignorado por ser draft/prerelease.`
      );
      return null;
    }

    return this.upsertRelease(normalizedRelease);
  }

  // Busca todas as versoes para a linha do tempo (da mais recente para a mais antiga)
  async getTimeline() {
    return this.releaseModel.find()
      .sort({ publishedAt: -1 })
      .limit(50);
  }

  async getLatestWithDiagnostics() {
    const cachedRelease = await this.releaseModel.findOne().sort({ publishedAt: -1 });

    try {
      const normalizedRelease = await this.fetchLatestGitHubRelease();
      const syncedRelease = await this.upsertRelease(normalizedRelease);

      return {
        release: this.toReleaseResponse(syncedRelease),
        meta: {
          source: 'github',
          usedFallback: false,
          repository: this.getExpectedRepositoryFullName(),
        },
      };
    } catch (error) {
      this.logGitHubFailure(error, cachedRelease);

      if (!cachedRelease) {
        throw error;
      }

      return {
        release: this.toReleaseResponse(cachedRelease),
        meta: {
          source: 'database-fallback',
          usedFallback: true,
          repository: this.getExpectedRepositoryFullName(),
          errorCode: error.code || 'GITHUB_RELEASE_SYNC_FAILED',
        },
      };
    }
  }

  // Busca apenas a ultima para verificacao rapida na Home do App
  async getLatest() {
    const result = await this.getLatestWithDiagnostics();
    return result.release;
  }
}

module.exports = new ReleaseService();
