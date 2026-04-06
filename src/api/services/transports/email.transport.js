const GmailProvider = require('../../providers/gmail.provider');
const notificationTransportLogService = require('../notificationTransportLog.service');
const { mapDispatchErrorCode } = require('../../utils/notificationOutcome.util');

class EmailTransport {
  constructor({
    gmailProvider = new GmailProvider(),
    notificationTransportLogService: transportLogService = notificationTransportLogService,
    } = {}) {
    this.gmailProvider = gmailProvider;
    this.notificationTransportLogService = transportLogService;
  }

  async assertReady() {
    if (typeof this.gmailProvider.assertConfigured === 'function') {
      this.gmailProvider.assertConfigured();
    }

    return true;
  }

  async send({ notificationLog, invoice, config, message }) {
    const email = notificationLog?.target_email_normalized || notificationLog?.target_email;

    if (!email) {
      const error = new Error('Responsavel sem e-mail valido para envio.');
      error.code = 'MISSING_EMAIL_TARGET';
      throw error;
    }

    const attachments = Array.isArray(message?.attachmentsPlan) ? message.attachmentsPlan : [];

    const attempt = await this.notificationTransportLogService.createAttempt({
      schoolId: notificationLog.school_id,
      notificationLogId: notificationLog._id,
      invoiceId: invoice?._id || notificationLog.invoice_id || null,
      channel: 'email',
      provider: 'gmail',
      destination: email,
      destinationEmail: email,
      requestKind: attachments.length > 0 ? 'email_attachment' : 'email_html',
      source: 'email.transport',
      subject: message?.subject || null,
      bodyPreview: message?.message_preview || message?.text || null,
      attachments,
      metadata: {
        notification_type: notificationLog.type,
        delivery_key: notificationLog.delivery_key || null,
        dispatch_origin: notificationLog.dispatch_origin || null,
      },
      rawRequestPayload: {
        to: email,
        subject: message?.subject || null,
        attachmentsPlan: attachments,
      },
    });

    try {
      await this.assertReady();

      const providerResponse = await this.gmailProvider.sendMail({
        to: email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments,
        replyTo: config?.channels?.email?.replyTo || null,
      });

      let updatedAttempt = await this.notificationTransportLogService.markAccepted(attempt._id, {
        providerMessageId: providerResponse.id,
        internetMessageId: providerResponse.internetMessageId || null,
        providerThreadId: providerResponse.threadId,
        providerStatus: 'ACCEPTED',
        destination: email,
        destinationEmail: email,
        eventAt: new Date(),
        rawProviderResponse: providerResponse.rawResponse,
        source: 'email.transport',
      });

      updatedAttempt = await this.notificationTransportLogService.markSent(updatedAttempt._id, {
        providerMessageId: providerResponse.id,
        internetMessageId: providerResponse.internetMessageId || null,
        providerThreadId: providerResponse.threadId,
        providerStatus: 'SENT',
        destination: email,
        destinationEmail: email,
        eventAt: new Date(),
        rawProviderResponse: providerResponse.rawResponse,
        source: 'email.transport',
      });

      return {
        attempt: updatedAttempt,
        response: providerResponse,
      };
    } catch (error) {
      const mappedCode = mapDispatchErrorCode(error, 'email');
      const failedAttempt = await this.notificationTransportLogService.markFailed(attempt._id, {
        errorMessage: error.message || 'Falha ao enviar e-mail.',
        errorCode: mappedCode,
        errorHttpStatus: error.response?.status || null,
        rawLastError: error.response?.data || {
          message: error.message,
          stack: error.stack,
        },
        source: 'email.transport',
      });

      error.code = mappedCode;
      error.transportAttempt = failedAttempt;
      throw error;
    }
  }
}

module.exports = EmailTransport;
