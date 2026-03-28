const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');

const mode = String(process.argv[2] || '').trim().toLowerCase();
const isLocalMode = mode === 'local';
const isRenderMode = mode === 'render';

const DEFAULT_PORT = Number(process.env.ACADEMY_HUB_PORT || 8081);
const DEFAULT_EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:3000';
const DEFAULT_RENDER_URL =
  process.env.ACADEMY_HUB_RENDER_URL || 'https://school-management-api-76ef.onrender.com';

if (!isLocalMode && !isRenderMode) {
  console.error('Uso: node scripts/run-academy-hub.js <local|render>');
  console.error('');
  console.error('local  -> sobe a API em 8081 e publica o callback via ngrok');
  console.error('render -> sobe a API em modo production e aponta o webhook para o Render');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function spawnNgrok(port) {
  return spawn('ngrok', ['http', String(port)], {
    stdio: 'inherit',
  });
}

async function waitForNgrokUrl(port, timeoutMs = 30000) {
  const startedAt = Date.now();
  const portToken = `:${port}`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await axios.get('http://127.0.0.1:4040/api/tunnels', {
        timeout: 2000,
      });

      const tunnels = Array.isArray(response.data?.tunnels) ? response.data.tunnels : [];
      const tunnel = tunnels.find((item) => {
        const addr = String(item?.config?.addr || '');
        const publicUrl = String(item?.public_url || '');
        return addr.includes(portToken) && /^https:\/\//i.test(publicUrl);
      });

      if (tunnel?.public_url) {
        return String(tunnel.public_url).replace(/\/$/, '');
      }
    } catch (error) {
      // ngrok ainda pode estar subindo; seguimos tentando ate o timeout
    }

    await sleep(500);
  }

  throw new Error(`Nao foi possivel obter a URL publica do ngrok para a porta ${port}.`);
}

function spawnServer(env) {
  const serverPath = path.resolve(__dirname, '..', 'src', 'server.js');

  return spawn(process.execPath, [serverPath], {
    env,
    stdio: 'inherit',
  });
}

function buildEnv({ modeName, port, ngrokUrl }) {
  const env = {
    ...process.env,
    PORT: String(port),
    EVOLUTION_API_URL: DEFAULT_EVOLUTION_API_URL,
    NGROK_URL: ngrokUrl,
  };

  if (modeName === 'local') {
    env.NODE_ENV = 'development';
    env.PROD_URL = ngrokUrl;
    env.EVOLUTION_WEBHOOK_URL = `${ngrokUrl}/api/webhook/whatsapp`;
    return env;
  }

  env.NODE_ENV = 'production';
  env.PROD_URL = DEFAULT_RENDER_URL;
  env.EVOLUTION_WEBHOOK_URL = `${DEFAULT_RENDER_URL}/api/webhook/whatsapp`;
  return env;
}

async function main() {
  const modeName = isLocalMode ? 'local' : 'render';
  const port = DEFAULT_PORT;

  console.log(`[AcademyHub] modo=${modeName} porta=${port}`);
  console.log(`[AcademyHub] Evolution API local: ${DEFAULT_EVOLUTION_API_URL}`);

  const ngrokProc = spawnNgrok(port);

  ngrokProc.on('error', (error) => {
    console.error(`[AcademyHub] Falha ao iniciar ngrok: ${error.message}`);
    process.exit(1);
  });

  const ngrokUrl = await waitForNgrokUrl(port);

  console.log(`[AcademyHub] ngrok ativo: ${ngrokUrl}`);
  console.log(
    `[AcademyHub] EVOLUTION_WEBHOOK_URL=${modeName === 'local' ? `${ngrokUrl}/api/webhook/whatsapp` : `${DEFAULT_RENDER_URL}/api/webhook/whatsapp`}`
  );

  const serverEnv = buildEnv({
    modeName,
    port,
    ngrokUrl,
  });

  const serverProc = spawnServer(serverEnv);

  const shutdown = (exitCode = 0) => {
    if (!serverProc.killed) {
      serverProc.kill('SIGINT');
    }

    if (!ngrokProc.killed) {
      ngrokProc.kill('SIGINT');
    }

    process.exit(exitCode);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  serverProc.on('error', (error) => {
    console.error(`[AcademyHub] Falha ao iniciar o servidor: ${error.message}`);
    shutdown(1);
  });

  serverProc.on('exit', (code, signal) => {
    if (!ngrokProc.killed) {
      ngrokProc.kill('SIGINT');
    }

    if (!shuttingDown && signal) {
      process.exit(1);
      return;
    }

    process.exit(typeof code === 'number' ? code : 0);
  });

  ngrokProc.on('exit', (code, signal) => {
    if (serverProc.exitCode === null && serverProc.signalCode === null) {
      console.error(
        `[AcademyHub] ngrok encerrou inesperadamente (code=${code}, signal=${signal || 'N/A'}).`
      );
      serverProc.kill('SIGINT');
      process.exit(1);
    }
  });
}

main().catch((error) => {
  console.error(`[AcademyHub] Erro no launcher: ${error.message}`);
  process.exit(1);
});
