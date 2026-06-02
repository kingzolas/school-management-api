const { S3Client } = require('@aws-sdk/client-s3');

let cachedClient = null;

const R2_ENV_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT',
];

function getR2Health() {
  return {
    accountIdConfigured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
    bucketConfigured: Boolean(process.env.R2_BUCKET_NAME),
    endpointConfigured: Boolean(process.env.R2_ENDPOINT),
    accessKeyConfigured: Boolean(process.env.R2_ACCESS_KEY_ID),
    secretKeyConfigured: Boolean(process.env.R2_SECRET_ACCESS_KEY),
    publicBaseUrlConfigured: Boolean(process.env.R2_PUBLIC_BASE_URL),
    ready: R2_ENV_KEYS.every((key) => Boolean(process.env[key])),
  };
}

function assertR2Config() {
  const missing = R2_ENV_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    const error = new Error('Configuracao do Cloudflare R2 incompleta.');
    error.code = 'R2_CONFIG_INCOMPLETE';
    error.status = 503;
    error.missing = missing;
    throw error;
  }
}

function getR2BucketName() {
  assertR2Config();
  return process.env.R2_BUCKET_NAME;
}

function getR2Client() {
  assertR2Config();

  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });
  }

  return cachedClient;
}

module.exports = {
  getR2Client,
  getR2BucketName,
  getR2Health,
};
