// src/api/controllers/assistant.controller.js
const AssistantService = require('../services/assistant.service');

class AssistantController {

  /**
   * Recebe a mensagem do chat e processa com a IA
   */
  async handleChat(req, res, next) {
    const startTime = Date.now();
    
    // Extração de dados do usuário autenticado
    const userId = req.user ? req.user.id : 'anônimo';
    
    // [AJUSTE 1] Extrair o schoolId do token (pode vir como school_id ou schoolId)
    const schoolId = req.user ? (req.user.school_id || req.user.schoolId) : null;

    console.log(`\n🔵 [CONTROLLER] Nova requisição de Chat recebida.`);
    console.log(`👤 Usuário: ${userId}`);
    console.log(`🏫 Escola ID: ${schoolId}`);
    
    // 1. Aumentar o timeout desta resposta específica para 60 segundos
    res.setTimeout(60000, () => {
        console.error('❌ [CONTROLLER] Timeout de conexão (60s) atingido antes da resposta da IA.');
    });

    try {
      const { message, history } = req.body;

      // Validações básicas
      if (!message) {
        return res.status(400).json({ 
            success: false, 
            message: 'O campo "message" é obrigatório.' 
        });
      }

      // [AJUSTE 2] Validar se temos a escola
      if (!schoolId) {
        return res.status(400).json({ 
            success: false, 
            message: 'Identificação da escola não encontrada. Faça login novamente.' 
        });
      }

      console.log(`📝 Pergunta: "${message}"`);
      console.log(`⏳ Chamando AssistantService... (Aguardando IA)`);

      // [AJUSTE 3] Passar schoolId como 4º argumento
      const responseText = await AssistantService.generateResponse(
          message, 
          history, 
          userId, 
          schoolId // <--- Fundamental para o contexto
      );

      const duration = (Date.now() - startTime) / 1000;
      console.log(`✅ [CONTROLLER] Resposta recebida do Serviço em ${duration}s`);
      // console.log(`📤 Enviando para o Frontend: "${responseText.substring(0, 50)}..."`);

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