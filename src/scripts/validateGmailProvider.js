const GmailProvider = require('../api/providers/gmail.provider');

async function main() {
  const provider = new GmailProvider();
  const validation = await provider.validateAccess();
  const sender = provider.getSender();

  console.log(JSON.stringify({
    message: 'Gmail provider validado com sucesso.',
    sender,
    validation,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    error: error.code || 'GMAIL_VALIDATE_FAILED',
    message: error.message,
    missingEnv: error.missingEnv || null,
  }, null, 2));
  process.exit(1);
});
