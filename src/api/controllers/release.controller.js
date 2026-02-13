const ReleaseService = require('../services/release.service');

class ReleaseController {
  
  // POST /api/releases/webhook
  // Endpoint que o GitHub vai chamar
  async handleGitHubWebhook(req, res) {
    try {
      // O payload do GitHub vem no body
      await ReleaseService.syncGitHubRelease(req.body);
      
      // Responde rápido para o GitHub não dar timeout
      return res.status(200).json({ message: 'Webhook received' });
    } catch (error) {
      console.error('Erro no Webhook GitHub:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // GET /api/releases
  // Endpoint que o APP vai chamar para montar a Linha do Tempo
  async list(req, res) {
    try {
      const releases = await ReleaseService.getTimeline();
      return res.json(releases);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/releases/latest
  // Endpoint que o APP chama ao abrir para ver se tem update
  async getLatest(req, res) {
    try {
      const latest = await ReleaseService.getLatest();
      return res.json(latest);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new ReleaseController();