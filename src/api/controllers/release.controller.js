const ReleaseService = require('../services/release.service');

class ReleaseController {
  
  // POST /api/releases/webhook
  // Endpoint que o GitHub vai chamar
  async handleGitHubWebhook(req, res) {
    // [LOG DE DEBUG] Para confirmar que o GitHub chegou até aqui
    console.log('\n--- 🔔 WEBHOOK GITHUB ACIONADO ---');
    console.log('User-Agent:', req.headers['user-agent']); // Deve mostrar algo como GitHub-Hookshot/...
    console.log('Ação recebida:', req.body?.action); // Mostra se foi "published", "edited", etc.
    
    try {
      // Verificação de segurança básica
      if (!req.body || Object.keys(req.body).length === 0) {
        console.error('❌ Erro: Body vazio ou inválido recebido no Webhook.');
        return res.status(400).json({ error: 'Payload missing' });
      }

      // Chama o serviço para processar
      const result = await ReleaseService.syncGitHubRelease(req.body);
      
      if (result) {
        console.log(`✅ Sucesso: Release ${result.tag} sincronizada/atualizada.`);
      } else {
        console.log('ℹ️ Info: Webhook processado, mas nenhuma ação de banco necessária (filtro de ação).');
      }

      // Responde rápido para o GitHub não dar timeout e marcar como falha
      return res.status(200).json({ message: 'Webhook received successfully' });

    } catch (error) {
      console.error('❌ Erro CRÍTICO no Webhook GitHub:', error);
      // Mesmo com erro interno, as vezes é bom retornar 200 pro GitHub não ficar tentando de novo infinitamente, 
      // mas vamos manter 500 para você saber que deu erro nos testes.
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
      console.error('Erro ao listar releases:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // GET /api/releases/latest
  // Endpoint que o APP chama ao abrir para ver se tem update
  async getLatest(req, res) {
    try {
      const latest = await ReleaseService.getLatest();
      // Se não tiver nenhuma release ainda, retorna null com status 200 (não é erro)
      return res.json(latest);
    } catch (error) {
      console.error('Erro ao buscar última release:', error);
      return res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new ReleaseController();