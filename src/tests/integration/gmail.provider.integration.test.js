const test = require('node:test');
const assert = require('node:assert/strict');

const GmailProvider = require('../../api/providers/gmail.provider');

test('GmailProvider fails clearly when required envs are missing', () => {
  const provider = new GmailProvider({
    GMAIL_OAUTH_CLIENT_ID: '',
    GMAIL_OAUTH_CLIENT_SECRET: '',
    GMAIL_OAUTH_REFRESH_TOKEN: '',
    GMAIL_OAUTH_REDIRECT_URI: '',
    GMAIL_SENDER_EMAIL: '',
    GMAIL_SENDER_NAME: '',
  });

  assert.throws(() => provider.assertConfigured(), (error) => {
    assert.equal(error.code, 'GMAIL_ENV_MISSING');
    assert.ok(Array.isArray(error.missingEnv));
    assert.ok(error.missingEnv.includes('GMAIL_OAUTH_REFRESH_TOKEN'));
    return true;
  });
});

test('GmailProvider runtime config does not require redirect URI when refresh token already exists', () => {
  const provider = new GmailProvider({
    GMAIL_OAUTH_CLIENT_ID: 'client-id',
    GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
    GMAIL_OAUTH_REFRESH_TOKEN: 'refresh-token',
    GMAIL_OAUTH_REDIRECT_URI: '',
    GMAIL_SENDER_EMAIL: 'cobranca@academyhubsistema.com',
    GMAIL_SENDER_NAME: 'Academy Hub | Cobrança',
  });

  assert.doesNotThrow(() => provider.assertConfigured());
  assert.deepEqual(provider.getMissingEnvNames(), []);
  assert.deepEqual(provider.getMissingEnvNames({ includeRedirectUri: true }), ['GMAIL_OAUTH_REDIRECT_URI']);
});
