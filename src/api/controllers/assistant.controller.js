// src/api/controllers/assistant.controller.js
const AssistantService = require('../services/assistant.service');

class AssistantController {

  /**
   * Recebe a mensagem do chat e processa com a IA
   */
  async handleChat(req, res, next) {
    const startTime = Date.now();
    const userId = req.user ? req.user.id : 'anônimo';

    console.log(`\n🔵 [CONTROLLER] Nova requisição de Chat recebida.`);
    console.log(`👤 Usuário: ${userId}`);
    
    // 1. Aumentar o timeout desta resposta específica para 60 segundos
    // Isso evita que o servidor corte a conexão enquanto a IA pensa (fallbacks demoram ~15s)
    res.setTimeout(60000, () => {
        console.error('❌ [CONTROLLER] Timeout de conexão (60s) atingido antes da resposta da IA.');
    });

    try {
      const { message, history } = req.body;

      if (!message) {
        return res.status(400).json({ 
            success: false, 
            message: 'O campo "message" é obrigatório.' 
        });
      }

      console.log(`📝 Pergunta: "${message}"`);
      console.log(`⏳ Chamando AssistantService... (Aguardando IA)`);

      // Chama o serviço (que agora tem a lógica de retry/fallback que criamos)
      const responseText = await AssistantService.generateResponse(message, history, userId);

      const duration = (Date.now() - startTime) / 1000;
      console.log(`✅ [CONTROLLER] Resposta recebida do Serviço em ${duration}s`);
      console.log(`📤 Enviando para o Frontend: "${responseText.substring(0, 50)}..."`);

      // 2. Retorno Padronizado para o Flutter
      return res.status(200).json({
        success: true,
        response: responseText // O Flutter deve ler este campo
      });

    } catch (error) {
      console.error('❌ [CONTROLLER] Erro fatal no handleChat:', error);
      
      // Retorna erro JSON para o Flutter não ficar carregando infinitamente
      return res.status(500).json({
        success: false,
        message: 'Erro interno ao processar resposta da IA.',
        error: error.message
      });
    }
  }
}

module.exports = new AssistantController();