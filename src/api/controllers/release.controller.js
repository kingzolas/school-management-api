const ReleaseService = require('../services/release.service');

class ReleaseController {
  // POST /api/releases/webhook
  // Endpoint que o GitHub vai chamar
  async handleGitHubWebhook(req, res) {
    console.log('\n--- WEBHOOK GITHUB ACIONADO ---');
    console.log('User-Agent:', req.headers['user-agent']);
    console.log('Acao recebida:', req.body?.action);

    try {
      if (!req.body || Object.keys(req.body).length === 0) {
        console.error('Erro: body vazio ou invalido recebido no webhook.');
        return res.status(400).json({ error: 'Payload missing' });
      }

      const result = await ReleaseService.syncGitHubRelease(req.body);

      if (result) {
        console.log(`Sucesso: release ${result.tag} sincronizada/atualizada.`);
      } else {
        console.log('Info: webhook processado sem alteracao de banco.');
      }

      return res.status(200).json({ message: 'Webhook received successfully' });
    } catch (error) {
      console.error('Erro critico no webhook GitHub:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // GET /api/releases
  // Endpoint que o app vai chamar para montar a linha do tempo
  async list(req, res) {
    try {
      const releases = await ReleaseService.getTimeline();
      return res.json(releases);
    } catch (error) {
      console.error('Erro ao listar releases:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/releases/latest
  // Endpoint que o app chama ao abrir para ver se tem update
  async getLatest(req, res) {
    try {
      const { release, meta } = await ReleaseService.getLatestWithDiagnostics();

      if (meta?.source) {
        res.setHeader('X-Release-Source', meta.source);
      }
      if (meta?.usedFallback) {
        res.setHeader('X-Release-Fallback', 'database');
      }
      if (meta?.errorCode) {
        res.setHeader('X-Release-Sync-Error', meta.errorCode);
      }

      return res.json(release);
    } catch (error) {
      console.error('Erro ao buscar ultima release:', error);
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  }
}

module.exports = new ReleaseController();
