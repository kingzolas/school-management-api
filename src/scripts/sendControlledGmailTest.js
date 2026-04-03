const GmailProvider = require('../api/providers/gmail.provider');

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function buildHtml({ subject, body, paymentLink, barcode, pixCode }) {
  const sections = [
    `<p>${String(body || '').replace(/\n/g, '<br>')}</p>`,
  ];

  if (paymentLink) {
    sections.push(`<p><strong>Link para pagamento:</strong><br><a href="${paymentLink}">${paymentLink}</a></p>`);
  }

  if (barcode) {
    sections.push(`<p><strong>Linha digitável:</strong><br>${barcode}</p>`);
  }

  if (pixCode) {
    sections.push(`<p><strong>PIX copia e cola:</strong><br>${pixCode}</p>`);
  }

  return `<html><body><h2>${subject}</h2>${sections.join('')}</body></html>`;
}

async function main() {
  const to = getArg('to') || process.env.GMAIL_TEST_TO;
  if (!to) {
    throw new Error('Informe o destinatario com --to=email@dominio.com ou GMAIL_TEST_TO.');
  }

  const paymentLink = getArg('paymentLink') || 'https://academyhubsistema.com/cobranca-teste';
  const barcode = getArg('barcode') || '23793381286008200009012000004702975870000002000';
  const pixCode = getArg('pixCode') || '00020101021226880014br.gov.bcb.pix2566qrcodepix.test/academyhub520400005303986540520.005802BR5925Academy Hub Cobranca6009Sao Paulo62070503***6304ABCD';
  const attachmentUrl = getArg('attachmentUrl') || null;
  const subject = getArg('subject') || 'Teste controlado de cobrança por e-mail';
  const body = [
    'Este é um envio controlado de homologação do canal de e-mail.',
    '',
    'Ele valida assunto, corpo, link, linha digitável, PIX e metadados retornados pela Gmail API.',
    '',
    'Atenciosamente,',
    'Equipe Financeira',
    'Academy Hub',
  ].join('\n');

  const attachments = attachmentUrl ? [{
    type: 'boleto_pdf',
    filename: 'boleto_teste.pdf',
    sourceUrl: attachmentUrl,
    mimeType: 'application/pdf',
    required: false,
    fallbackToLink: true,
  }] : [];

  const provider = new GmailProvider();
  const response = await provider.sendMail({
    to,
    subject,
    text: [body, '', `Link para pagamento: ${paymentLink}`, '', `Linha digitável: ${barcode}`, '', `PIX copia e cola: ${pixCode}`].join('\n'),
    html: buildHtml({ subject, body, paymentLink, barcode, pixCode }),
    attachments,
  });

  console.log(JSON.stringify({
    message: 'E-mail controlado enviado com sucesso.',
    to,
    subject,
    paymentLink,
    barcode,
    pixCode,
    attachmentCount: attachments.length,
    response,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    error: error.code || 'GMAIL_CONTROLLED_SEND_FAILED',
    message: error.message,
    missingEnv: error.missingEnv || null,
  }, null, 2));
  process.exit(1);
});
