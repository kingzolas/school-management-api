require('dotenv').config();

const mongoose = require('mongoose');

require('../api/models/student.model');
require('../api/models/tutor.model');

const School = require('../api/models/school.model');
const Invoice = require('../api/models/invoice.model');
const billingMessageComposerService = require('../api/services/billingMessageComposer.service');
const notificationRecipientResolverService = require('../api/services/notificationRecipientResolver.service');
const GmailProvider = require('../api/providers/gmail.provider');

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

async function findSchoolByName(name) {
  const regex = new RegExp(name, 'i');
  return School.findOne({ name: regex }).lean();
}

async function findInvoiceForHomologation({ schoolId, invoiceId = null, referenceDate = new Date() }) {
  if (invoiceId) {
    return Invoice.findOne({ _id: invoiceId, school_id: schoolId })
      .populate('student')
      .populate('tutor');
  }

  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0, 23, 59, 59, 999);

  return Invoice.findOne({
    school_id: schoolId,
    status: { $in: ['pending', 'overdue'] },
    dueDate: { $gte: start, $lte: end },
    boleto_url: { $exists: true, $ne: null },
  })
    .sort({ dueDate: 1, createdAt: 1 })
    .populate('student')
    .populate('tutor');
}

async function main() {
  const dryRun = String(getArg('dryRun') || 'false').toLowerCase() === 'true';
  const to = getArg('to') || process.env.GMAIL_TEST_TO || (dryRun ? process.env.GMAIL_SENDER_EMAIL : null);
  if (!to) {
    const error = new Error('Informe o e-mail de teste com --to=email@dominio.com ou GMAIL_TEST_TO.');
    error.code = 'HOMOLOGATION_TEST_EMAIL_REQUIRED';
    throw error;
  }

  const schoolName = getArg('schoolName') || 'A Sementinha';
  const invoiceId = getArg('invoiceId') || null;
  const referenceDate = new Date();

  await mongoose.connect(process.env.MONGO_URI);

  const school = await findSchoolByName(schoolName);
  if (!school) {
    const error = new Error(`Escola não encontrada: ${schoolName}`);
    error.code = 'HOMOLOGATION_SCHOOL_NOT_FOUND';
    throw error;
  }

  const invoice = await findInvoiceForHomologation({
    schoolId: school._id,
    invoiceId,
    referenceDate,
  });

  if (!invoice) {
    const error = new Error('Nenhuma invoice elegível encontrada para homologação local.');
    error.code = 'HOMOLOGATION_INVOICE_NOT_FOUND';
    throw error;
  }

  const recipient = await notificationRecipientResolverService.resolveByInvoice(invoice);
  const config = {
    channels: {
      email: {
        attachBoletoPdf: true,
        subjectPrefix: '[HOMOLOGAÇÃO LOCAL]',
        replyTo: process.env.GMAIL_SENDER_EMAIL,
      },
      whatsapp: {
        sendPdfWhenAvailable: true,
      },
    },
  };

  const message = billingMessageComposerService.compose({
    notificationLog: {
      type: 'new_invoice',
      recipient_name: recipient.recipient_name,
      tutor_name: recipient.tutor_name,
      student_name: recipient.student_name,
      recipient_snapshot: recipient.recipient_snapshot,
      business_timezone: 'America/Sao_Paulo',
    },
    invoice,
    school,
    config,
    referenceDate,
  });

  const preview = {
    school: school.name,
    invoiceId: String(invoice._id),
    description: invoice.description,
    dueDate: invoice.dueDate,
    status: invoice.status,
    gateway: invoice.gateway,
    realRecipientOnInvoice: invoice?.tutor?.email || invoice?.student?.email || null,
    homologationRecipient: to,
    from: {
      email: process.env.GMAIL_SENDER_EMAIL,
      name: process.env.GMAIL_SENDER_NAME,
    },
    subject: message.subject,
    greetingLine: String(message.text || '').split('\n')[0],
    hasPaymentLink: Boolean(message.payment_link),
    hasBarcode: Boolean(message.barcode),
    hasDigitableLine: Boolean(message.digitable_line),
    savedBarcode: invoice.boleto_barcode || null,
    savedDigitableLine: invoice.boleto_digitable_line || null,
    emailDigitableLine: message.digitable_line || null,
    hasPix: Boolean(message.pix_code),
    attachmentsPlan: message.attachmentsPlan,
  };

  if (dryRun) {
    console.log(JSON.stringify({
      mode: 'dry_run',
      ...preview,
      bodyPreview: message.text,
      htmlPreview: message.html,
    }, null, 2));
    return;
  }

  const provider = new GmailProvider();
  const response = await provider.sendMail({
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachmentsPlan,
    replyTo: process.env.GMAIL_SENDER_EMAIL,
  });

  console.log(JSON.stringify({
    mode: 'sent',
    ...preview,
    messageId: response.id,
    threadId: response.threadId,
    attachments: response.attachments,
  }, null, 2));
}

main()
  .catch(async (error) => {
    console.error(JSON.stringify({
      error: error.code || 'HOMOLOGATION_SEND_FAILED',
      message: error.message,
      missingEnv: error.missingEnv || null,
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // noop
    }
  });
