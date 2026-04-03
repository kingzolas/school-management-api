const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function loadOptionalEnvFiles() {
  const originalEnvKeys = new Set(Object.keys(process.env));
  const envPath = path.resolve(process.cwd(), '.env');
  const localEnvPath = path.resolve(process.cwd(), '.env.local');

  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }

  if (fs.existsSync(localEnvPath)) {
    const parsedLocal = dotenv.parse(fs.readFileSync(localEnvPath));
    Object.entries(parsedLocal).forEach(([key, value]) => {
      if (originalEnvKeys.has(key)) {
        return;
      }

      process.env[key] = value;
    });
  }
}

loadOptionalEnvFiles();

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function escapeHeader(value) {
  return String(value || '').replace(/\r?\n/g, ' ').trim();
}

function encodeHeaderWord(value) {
  const normalized = escapeHeader(value);
  if (!normalized) return '';
  return `=?UTF-8?B?${Buffer.from(normalized, 'utf8').toString('base64')}?=`;
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildAddressHeader(name, email) {
  const safeEmail = escapeHeader(email);
  const safeName = escapeHeader(name);

  if (!safeName) return safeEmail;
  return `${encodeHeaderWord(safeName)} <${safeEmail}>`;
}

function encodeBodyBase64(value) {
  const normalized = String(value || '');
  const base64 = Buffer.from(normalized, 'utf8').toString('base64');
  return base64.match(/.{1,76}/g)?.join('\r\n') || '';
}

function buildMimeMessage({
  to,
  from,
  replyTo = null,
  subject,
  text,
  html = null,
  attachments = [],
}) {
  const mixedBoundary = `mixed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines = [];

  lines.push(`From: ${from}`);
  lines.push(`To: ${escapeHeader(to)}`);
  if (replyTo) lines.push(`Reply-To: ${replyTo}`);
  lines.push(`Subject: ${encodeHeaderWord(subject)}`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push(`Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@academyhubsistema.com>`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Language: pt-BR');

  if (attachments.length > 0) {
    lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    lines.push('');
    lines.push(`--${mixedBoundary}`);
  }

  if (html) {
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push('');
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(encodeBodyBase64(text || ''));
    lines.push('');
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(encodeBodyBase64(html));
    lines.push('');
    lines.push(`--${altBoundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(encodeBodyBase64(text || ''));
  }

  if (attachments.length > 0) {
    lines.push('');

    attachments.forEach((attachment) => {
      lines.push(`--${mixedBoundary}`);
      lines.push(`Content-Type: ${attachment.mimeType || 'application/octet-stream'}; name="${escapeHeader(attachment.filename || 'attachment')}"`);
      lines.push(`Content-Disposition: attachment; filename="${escapeHeader(attachment.filename || 'attachment')}"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      lines.push((attachment.contentBase64 || '').match(/.{1,76}/g)?.join('\r\n') || '');
      lines.push('');
    });

    lines.push(`--${mixedBoundary}--`);
  }

  return lines.join('\r\n');
}

class GmailProvider {
  constructor(env = process.env) {
    this.env = env;
    this.runtimeEnvNames = [
      'GMAIL_OAUTH_CLIENT_ID',
      'GMAIL_OAUTH_CLIENT_SECRET',
      'GMAIL_OAUTH_REFRESH_TOKEN',
      'GMAIL_SENDER_EMAIL',
      'GMAIL_SENDER_NAME',
    ];
    this.bootstrapEnvNames = [
      'GMAIL_OAUTH_CLIENT_ID',
      'GMAIL_OAUTH_CLIENT_SECRET',
      'GMAIL_OAUTH_REDIRECT_URI',
      'GMAIL_SENDER_EMAIL',
      'GMAIL_SENDER_NAME',
    ];
  }

  getMissingEnvNames({ includeRedirectUri = false } = {}) {
    const envNames = includeRedirectUri ? this.bootstrapEnvNames : this.runtimeEnvNames;
    return envNames.filter((key) => !normalizeString(this.env[key]));
  }

  assertConfigured(options = {}) {
    const missing = this.getMissingEnvNames(options);
    if (missing.length > 0) {
      const error = new Error(`Gmail provider nao configurado. Variaveis ausentes: ${missing.join(', ')}`);
      error.code = 'GMAIL_ENV_MISSING';
      error.missingEnv = missing;
      throw error;
    }
  }

  getSender() {
    return {
      email: normalizeString(this.env.GMAIL_SENDER_EMAIL),
      name: normalizeString(this.env.GMAIL_SENDER_NAME),
    };
  }

  getAuthorizationUrl({ state = 'academyhub-gmail-bootstrap', prompt = 'consent' } = {}) {
    let google;
    try {
      ({ google } = require('googleapis'));
    } catch (error) {
      const dependencyError = new Error('Dependencia googleapis nao instalada. Execute a instalacao de dependencias antes de usar o canal email.');
      dependencyError.code = 'GOOGLEAPIS_NOT_INSTALLED';
      throw dependencyError;
    }

    if (!normalizeString(this.env.GMAIL_OAUTH_CLIENT_ID) ||
        !normalizeString(this.env.GMAIL_OAUTH_CLIENT_SECRET) ||
        !normalizeString(this.env.GMAIL_OAUTH_REDIRECT_URI)) {
      const error = new Error('Nao foi possivel gerar a URL OAuth. Configure GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET e GMAIL_OAUTH_REDIRECT_URI.');
      error.code = 'GMAIL_BOOTSTRAP_ENV_MISSING';
      throw error;
    }

    const oauth2Client = new google.auth.OAuth2(
      this.env.GMAIL_OAUTH_CLIENT_ID,
      this.env.GMAIL_OAUTH_CLIENT_SECRET,
      this.env.GMAIL_OAUTH_REDIRECT_URI
    );

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt,
      scope: [GMAIL_SCOPE],
      state,
    });
  }

  async exchangeCodeForTokens(code) {
    const { google } = await this._getGoogleApis();

    if (!normalizeString(code)) {
      throw new Error('Codigo OAuth ausente para troca por refresh token.');
    }

    const oauth2Client = new google.auth.OAuth2(
      this.env.GMAIL_OAUTH_CLIENT_ID,
      this.env.GMAIL_OAUTH_CLIENT_SECRET,
      this.env.GMAIL_OAUTH_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  }

  async _getGoogleApis() {
    try {
      return require('googleapis');
    } catch (error) {
      const dependencyError = new Error('Dependencia googleapis nao instalada. Execute a instalacao de dependencias antes de usar o canal email.');
      dependencyError.code = 'GOOGLEAPIS_NOT_INSTALLED';
      throw dependencyError;
    }
  }

  async _createClient() {
    this.assertConfigured();

    const { google } = await this._getGoogleApis();
    const oauth2Client = new google.auth.OAuth2(
      this.env.GMAIL_OAUTH_CLIENT_ID,
      this.env.GMAIL_OAUTH_CLIENT_SECRET,
      normalizeString(this.env.GMAIL_OAUTH_REDIRECT_URI) || undefined
    );

    oauth2Client.setCredentials({
      refresh_token: this.env.GMAIL_OAUTH_REFRESH_TOKEN,
    });

    return { google, oauth2Client };
  }

  async validateAccess() {
    const { oauth2Client } = await this._createClient();
    const accessTokenResponse = await oauth2Client.getAccessToken();
    const accessToken =
      typeof accessTokenResponse === 'string'
        ? accessTokenResponse
        : accessTokenResponse?.token || null;

    if (!accessToken) {
      const error = new Error('Nao foi possivel obter access token a partir do refresh token configurado.');
      error.code = 'GMAIL_ACCESS_TOKEN_UNAVAILABLE';
      throw error;
    }

    const tokenInfo = await oauth2Client.getTokenInfo(accessToken);
    const scopes = Array.isArray(tokenInfo?.scopes)
      ? tokenInfo.scopes
      : String(tokenInfo?.scope || '')
          .split(' ')
          .map((item) => item.trim())
          .filter(Boolean);

    return {
      emailAddress: this.getSender().email,
      scopes,
      audience: tokenInfo?.aud || null,
      expiryDate: oauth2Client.credentials?.expiry_date || null,
      tokenType: oauth2Client.credentials?.token_type || null,
    };
  }

  async _downloadAttachment(attachment = {}) {
    const response = await axios.get(attachment.sourceUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300,
      headers: {
        'User-Agent': 'AcademyHub/GmailTransport',
      },
    });

    const buffer = Buffer.from(response.data);
    return {
      ...attachment,
      mimeType: attachment.mimeType || String(response.headers?.['content-type'] || 'application/octet-stream').split(';')[0].trim(),
      contentBase64: buffer.toString('base64'),
      size: buffer.length,
    };
  }

  async prepareAttachments(attachments = []) {
    const prepared = [];

    for (const attachment of attachments) {
      if (!attachment?.sourceUrl) {
        if (attachment?.required) {
          const error = new Error(`Attachment required without sourceUrl: ${attachment?.filename || attachment?.type || 'attachment'}`);
          error.code = 'EMAIL_ATTACHMENT_SOURCE_MISSING';
          throw error;
        }
        continue;
      }

      try {
        prepared.push(await this._downloadAttachment(attachment));
      } catch (error) {
        if (attachment?.required && attachment?.fallbackToLink === false) {
          error.code = error.code || 'EMAIL_ATTACHMENT_DOWNLOAD_FAILED';
          throw error;
        }
      }
    }

    return prepared;
  }

  async sendMail({
    to,
    subject,
    text,
    html = null,
    attachments = [],
    replyTo = null,
  }) {
    const { google, oauth2Client } = await this._createClient();
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const sender = this.getSender();
    const preparedAttachments = await this.prepareAttachments(attachments);

    const mimeMessage = buildMimeMessage({
      to,
      from: buildAddressHeader(sender.name, sender.email),
      replyTo: replyTo ? buildAddressHeader(sender.name, replyTo) : null,
      subject,
      text,
      html,
      attachments: preparedAttachments,
    });

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: toBase64Url(mimeMessage),
      },
    });

    return {
      id: response.data?.id || null,
      threadId: response.data?.threadId || null,
      labelIds: response.data?.labelIds || [],
      rawResponse: response.data || null,
      attachments: preparedAttachments.map((attachment) => ({
        type: attachment.type || null,
        filename: attachment.filename || null,
        mimeType: attachment.mimeType || null,
        sourceUrl: attachment.sourceUrl || null,
        size: attachment.size || null,
      })),
    };
  }
}

module.exports = GmailProvider;
