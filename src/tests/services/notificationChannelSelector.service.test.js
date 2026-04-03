const test = require('node:test');
const assert = require('node:assert/strict');

const { NotificationChannelSelectorService } = require('../../api/services/notificationChannelSelector.service');

test('channel selector uses primary channel when available', () => {
  const service = new NotificationChannelSelectorService();

  const result = service.selectChannel({
    config: {
      primaryChannel: 'whatsapp',
      allowFallback: true,
      fallbackChannel: 'email',
      channels: {
        whatsapp: { enabled: true, provider: 'evolution' },
        email: { enabled: true, provider: 'gmail' },
      },
    },
    recipient: {
      target_phone: '(91) 99999-0000',
      target_email: 'responsavel@example.com',
    },
  });

  assert.equal(result.channel, 'whatsapp');
  assert.equal(result.provider, 'evolution');
  assert.equal(result.used_fallback, false);
  assert.equal(result.resolution_reason, 'primary_channel_available');
});

test('channel selector chooses email directly when email is the primary channel and the recipient has email', () => {
  const service = new NotificationChannelSelectorService();

  const result = service.selectChannel({
    config: {
      primaryChannel: 'email',
      allowFallback: false,
      channels: {
        whatsapp: { enabled: true, provider: 'evolution' },
        email: { enabled: true, provider: 'gmail' },
      },
    },
    recipient: {
      target_phone: '(91) 99999-0000',
      target_email: 'responsavel@example.com',
    },
  });

  assert.equal(result.channel, 'email');
  assert.equal(result.provider, 'gmail');
  assert.equal(result.target_email, 'responsavel@example.com');
  assert.equal(result.used_fallback, false);
  assert.equal(result.resolution_reason, 'primary_channel_available');
});

test('channel selector falls back when primary is unavailable', () => {
  const service = new NotificationChannelSelectorService();

  const result = service.selectChannel({
    config: {
      primaryChannel: 'email',
      allowFallback: true,
      fallbackChannel: 'whatsapp',
      channels: {
        whatsapp: { enabled: true, provider: 'evolution' },
        email: { enabled: true, provider: 'gmail' },
      },
    },
    recipient: {
      target_phone: '(91) 98888-0000',
      target_email: null,
    },
  });

  assert.equal(result.channel, 'whatsapp');
  assert.equal(result.provider, 'evolution');
  assert.equal(result.used_fallback, true);
  assert.equal(result.resolution_reason, 'fallback_primary_unavailable');
});

test('channel selector returns no channel when primary is unavailable and fallback is disabled', () => {
  const service = new NotificationChannelSelectorService();

  const result = service.selectChannel({
    config: {
      primaryChannel: 'email',
      allowFallback: false,
      channels: {
        whatsapp: { enabled: true, provider: 'evolution' },
        email: { enabled: true, provider: 'gmail' },
      },
    },
    recipient: {
      target_phone: '(91) 98888-0000',
      target_email: null,
    },
  });

  assert.equal(result.channel, null);
  assert.equal(result.provider, null);
  assert.equal(result.resolution_reason, 'primary_channel_unavailable');
  assert.equal(result.reason_code, 'RECIPIENT_EMAIL_MISSING');
});

test('channel selector reports email disabled explicitly', () => {
  const service = new NotificationChannelSelectorService();

  const result = service.selectChannel({
    config: {
      primaryChannel: 'email',
      allowFallback: false,
      channels: {
        whatsapp: { enabled: true, provider: 'evolution' },
        email: { enabled: false, provider: 'gmail' },
      },
    },
    recipient: {
      target_email: 'responsavel@example.com',
      email_issue_code: null,
    },
  });

  assert.equal(result.channel, null);
  assert.equal(result.reason_code, 'EMAIL_CHANNEL_DISABLED');
  assert.equal(result.resolution_reason, 'primary_channel_disabled');
});

test('channel selector reports invalid email explicitly', () => {
  const service = new NotificationChannelSelectorService();

  const result = service.selectChannel({
    config: {
      primaryChannel: 'email',
      allowFallback: false,
      channels: {
        whatsapp: { enabled: true, provider: 'evolution' },
        email: { enabled: true, provider: 'gmail' },
      },
    },
    recipient: {
      target_email: 'email-invalido',
      email_issue_code: 'RECIPIENT_EMAIL_INVALID',
    },
  });

  assert.equal(result.channel, null);
  assert.equal(result.reason_code, 'RECIPIENT_EMAIL_INVALID');
  assert.equal(result.resolution_reason, 'primary_channel_unavailable');
});
