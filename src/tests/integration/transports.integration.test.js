const test = require('node:test');
const assert = require('node:assert/strict');

const WhatsappTransport = require('../../api/services/transports/whatsapp.transport');
const EmailTransport = require('../../api/services/transports/email.transport');

test('WhatsappTransport encapsulates legacy sendText and creates a generic accepted attempt', async () => {
  const calls = [];

  const transport = new WhatsappTransport({
    whatsappService: {
      async ensureConnection(schoolId) {
        calls.push({ type: 'ensureConnection', schoolId });
        return true;
      },
      async sendText(schoolId, phone, text, context) {
        calls.push({ type: 'sendText', schoolId, phone, text, context });
        return {
          key: {
            id: 'wa_msg_1',
            remoteJid: `${phone}@s.whatsapp.net`,
          },
          status: 'PENDING',
        };
      },
      async sendFile() {
        throw new Error('sendFile should not be called in this test');
      },
    },
    notificationTransportLogService: {
      async createAttempt(input) {
        calls.push({ type: 'createAttempt', input });
        return { _id: 'attempt_1' };
      },
      async markAccepted(attemptId, input) {
        calls.push({ type: 'markAccepted', attemptId, input });
        return { _id: attemptId, canonical_status: 'accepted', provider_message_id: 'wa_msg_1' };
      },
      async markFailed() {
        throw new Error('markFailed should not be called in this test');
      },
    },
  });

  const result = await transport.send({
    notificationLog: {
      _id: 'log_1',
      school_id: 'school_1',
      type: 'new_invoice',
      delivery_key: 'key_1',
      target_phone: '5511999999999',
      target_phone_normalized: '5511999999999',
    },
    invoice: { _id: 'inv_1' },
    message: {
      text: 'Mensagem de teste',
      message_preview: 'Mensagem de teste',
      attachmentsPlan: [],
      transportHints: { whatsapp: { shouldTryFile: false } },
    },
  });

  assert.equal(result.attempt.canonical_status, 'accepted');
  assert.equal(calls.find((call) => call.type === 'sendText').phone, '5511999999999');
  assert.equal(calls.find((call) => call.type === 'markAccepted').input.providerMessageId, 'wa_msg_1');
});

test('EmailTransport sends a single e-mail and registers accepted/sent transitions', async () => {
  const calls = [];

  const transport = new EmailTransport({
    gmailProvider: {
      async sendMail(input) {
        calls.push({ type: 'sendMail', input });
        return {
          id: 'gmail_msg_1',
          threadId: 'thread_1',
          rawResponse: { id: 'gmail_msg_1' },
        };
      },
    },
    notificationTransportLogService: {
      async createAttempt(input) {
        calls.push({ type: 'createAttempt', input });
        return { _id: 'attempt_1' };
      },
      async markAccepted(attemptId, input) {
        calls.push({ type: 'markAccepted', attemptId, input });
        return { _id: attemptId };
      },
      async markSent(attemptId, input) {
        calls.push({ type: 'markSent', attemptId, input });
        return { _id: attemptId, canonical_status: 'sent', provider_message_id: 'gmail_msg_1' };
      },
      async markFailed() {
        throw new Error('markFailed should not be called in this test');
      },
    },
  });

  const result = await transport.send({
    notificationLog: {
      _id: 'log_1',
      school_id: 'school_1',
      invoice_id: 'inv_1',
      target_email: 'teste@example.com',
      target_email_normalized: 'teste@example.com',
      type: 'new_invoice',
      delivery_key: 'key_1',
    },
    invoice: { _id: 'inv_1' },
    config: { channels: { email: { replyTo: 'financeiro@example.com' } } },
    message: {
      subject: 'Teste',
      text: 'Corpo',
      html: '<p>Corpo</p>',
      message_preview: 'Corpo',
      attachmentsPlan: [],
    },
  });

  assert.equal(result.attempt.canonical_status, 'sent');
  assert.equal(calls.find((call) => call.type === 'sendMail').input.to, 'teste@example.com');
  assert.equal(calls.find((call) => call.type === 'markSent').input.providerMessageId, 'gmail_msg_1');
});

test('EmailTransport classifies provider temporary failure with retryable code', async () => {
  const calls = [];

  const transport = new EmailTransport({
    gmailProvider: {
      assertConfigured() {
        return true;
      },
      async sendMail() {
        const error = new Error('Service unavailable');
        error.status = 503;
        error.response = {
          status: 503,
          data: { message: 'temporario' },
        };
        throw error;
      },
    },
    notificationTransportLogService: {
      async createAttempt() {
        return { _id: 'attempt_2' };
      },
      async markAccepted() {
        throw new Error('markAccepted should not be called');
      },
      async markSent() {
        throw new Error('markSent should not be called');
      },
      async markFailed(attemptId, input) {
        calls.push({ type: 'markFailed', attemptId, input });
        return { _id: attemptId, canonical_status: 'failed', error_code: input.errorCode };
      },
    },
  });

  await assert.rejects(
    () => transport.send({
      notificationLog: {
        _id: 'log_2',
        school_id: 'school_1',
        invoice_id: 'inv_2',
        target_email: 'teste@example.com',
        target_email_normalized: 'teste@example.com',
        type: 'manual',
        delivery_key: 'key_2',
      },
      invoice: { _id: 'inv_2' },
      config: { channels: { email: {} } },
      message: {
        subject: 'Teste',
        text: 'Corpo',
        html: '<p>Corpo</p>',
        message_preview: 'Corpo',
        attachmentsPlan: [],
      },
    }),
    (error) => {
      assert.equal(error.code, 'PROVIDER_TEMPORARY_FAILURE');
      assert.equal(error.transportAttempt.error_code, 'PROVIDER_TEMPORARY_FAILURE');
      return true;
    }
  );

  assert.equal(calls[0].input.errorCode, 'PROVIDER_TEMPORARY_FAILURE');
});
