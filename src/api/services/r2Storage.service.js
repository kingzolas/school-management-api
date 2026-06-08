const {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  getR2BucketName,
  getR2Client,
  getR2Health,
} = require('../../config/r2Client');

function assertSafeKey(key) {
  const normalized = String(key || '').trim();

  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\\')) {
    const error = new Error('Chave de storage invalida.');
    error.status = 400;
    error.code = 'INVALID_STORAGE_KEY';
    throw error;
  }

  return normalized;
}

function assertSafePrefix(prefix) {
  const normalized = String(prefix || '').trim();

  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\\')) {
    const error = new Error('Prefixo de storage invalido.');
    error.status = 400;
    error.code = 'INVALID_STORAGE_PREFIX';
    throw error;
  }

  return normalized;
}

function buildPublicUrl(key) {
  const baseUrl = String(process.env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return '';
  return `${baseUrl}/${String(key).replace(/^\/+/, '')}`;
}

class R2StorageService {
  getHealth() {
    return getR2Health();
  }

  async uploadBuffer({ key, buffer, contentType }) {
    const safeKey = assertSafeKey(key);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      const error = new Error('Buffer de upload invalido.');
      error.status = 400;
      error.code = 'INVALID_UPLOAD_BUFFER';
      throw error;
    }

    const result = await getR2Client().send(new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: safeKey,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }));

    return {
      key: safeKey,
      etag: result.ETag || null,
      publicUrl: buildPublicUrl(safeKey),
    };
  }

  async deleteObject(key) {
    const safeKey = assertSafeKey(key);
    await getR2Client().send(new DeleteObjectCommand({
      Bucket: getR2BucketName(),
      Key: safeKey,
    }));

    return { key: safeKey, deleted: true };
  }

  async deleteObjects(keys = []) {
    const normalizedKeys = [...new Set(
      (Array.isArray(keys) ? keys : [])
        .map((key) => assertSafeKey(key))
        .filter(Boolean)
    )];

    if (normalizedKeys.length === 0) {
      return {
        deleted: [],
        errors: [],
        deletedCount: 0,
      };
    }

    const response = await getR2Client().send(new DeleteObjectsCommand({
      Bucket: getR2BucketName(),
      Delete: {
        Objects: normalizedKeys.map((key) => ({ Key: key })),
        Quiet: false,
      },
    }));

    const deleted = Array.isArray(response?.Deleted)
      ? response.Deleted.map((item) => String(item.Key || '')).filter(Boolean)
      : [];

    const errors = Array.isArray(response?.Errors)
      ? response.Errors.map((item) => ({
        key: String(item.Key || ''),
        code: item.Code || 'R2_DELETE_FAILED',
        message: item.Message || 'Falha ao remover objeto do R2.',
      }))
      : [];

    return {
      deleted,
      errors,
      deletedCount: deleted.length,
    };
  }

  async listObjectsByPrefix(prefix) {
    const safePrefix = assertSafePrefix(prefix);
    const keys = [];
    let continuationToken;

    do {
      const response = await getR2Client().send(new ListObjectsV2Command({
        Bucket: getR2BucketName(),
        Prefix: safePrefix,
        ContinuationToken: continuationToken,
      }));

      const pageKeys = Array.isArray(response?.Contents)
        ? response.Contents.map((item) => String(item.Key || '')).filter(Boolean)
        : [];

      keys.push(...pageKeys);
      continuationToken = response?.IsTruncated ? response?.NextContinuationToken : undefined;
    } while (continuationToken);

    return [...new Set(keys)];
  }

  async deletePrefix(prefix) {
    const safePrefix = assertSafePrefix(prefix);
    const keys = await this.listObjectsByPrefix(safePrefix);
    return this.deleteObjects(keys);
  }

  async getSignedDownloadUrl(key, expiresIn = 300) {
    const safeKey = assertSafeKey(key);
    const command = new GetObjectCommand({
      Bucket: getR2BucketName(),
      Key: safeKey,
    });

    const url = await getSignedUrl(getR2Client(), command, {
      expiresIn: Math.min(Math.max(Number(expiresIn) || 300, 60), 3600),
    });

    return { key: safeKey, url };
  }

  async downloadBuffer(key) {
    const safeKey = assertSafeKey(key);

    try {
      const response = await getR2Client().send(new GetObjectCommand({
        Bucket: getR2BucketName(),
        Key: safeKey,
      }));

      if (!response?.Body) {
        const error = new Error('Objeto encontrado no R2, mas sem corpo de resposta.');
        error.status = 502;
        error.code = 'EMPTY_R2_OBJECT_BODY';
        throw error;
      }

      if (typeof response.Body.transformToByteArray === 'function') {
        const bytes = await response.Body.transformToByteArray();
        return Buffer.from(bytes);
      }

      if (typeof response.Body.transformToString === 'function') {
        const text = await response.Body.transformToString();
        return Buffer.from(text);
      }

      if (Buffer.isBuffer(response.Body)) {
        return response.Body;
      }

      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      if (status === 404 || error?.name === 'NotFound' || error?.Code === 'NoSuchKey') {
        const notFound = new Error('Objeto nao encontrado no R2.');
        notFound.status = 404;
        notFound.code = 'R2_OBJECT_NOT_FOUND';
        throw notFound;
      }

      if (error?.code) throw error;

      const wrapped = new Error(`Falha ao baixar objeto do R2: ${error?.message || 'erro desconhecido'}`);
      wrapped.status = 502;
      wrapped.code = 'R2_DOWNLOAD_FAILED';
      throw wrapped;
    }
  }

  async objectExists(key) {
    const safeKey = assertSafeKey(key);

    try {
      await getR2Client().send(new HeadObjectCommand({
        Bucket: getR2BucketName(),
        Key: safeKey,
      }));
      return true;
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      if (status === 404 || error?.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }
}

module.exports = new R2StorageService();
module.exports.assertSafeKey = assertSafeKey;
module.exports.assertSafePrefix = assertSafePrefix;
