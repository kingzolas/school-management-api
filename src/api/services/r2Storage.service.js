const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
