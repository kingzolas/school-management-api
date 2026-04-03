const GmailProvider = require('../api/providers/gmail.provider');

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

async function main() {
  const provider = new GmailProvider();
  const code = getArg('code') || process.env.GMAIL_OAUTH_CODE || null;

  if (code) {
    const tokens = await provider.exchangeCodeForTokens(code);
    console.log(JSON.stringify({
      message: 'OAuth code trocado com sucesso. Guarde o refresh_token no Render/.env.local.',
      refresh_token: tokens.refresh_token || null,
      expiry_date: tokens.expiry_date || null,
      scope: tokens.scope || null,
      token_type: tokens.token_type || null,
    }, null, 2));
    return;
  }

  const url = provider.getAuthorizationUrl();
  console.log(JSON.stringify({
    message: 'Abra a URL abaixo com a conta cobranca@academyhubsistema.com e depois rode novamente com --code=<codigo>.',
    authorization_url: url,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    error: error.code || 'GMAIL_BOOTSTRAP_FAILED',
    message: error.message,
    missingEnv: error.missingEnv || null,
  }, null, 2));
  process.exit(1);
});
