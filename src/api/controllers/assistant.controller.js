// src/api/controllers/assistant.controller.js
const AssistantService = require('../services/assistant.service');

class AssistantController {

  /**
   * Ponto de entrada para o "Olho de Deus"
   * Recebe a pergunta, orquestra o serviço RAG e devolve a resposta.
   */
  async handleQuery(req, res) {
    const startTime = Date.now();
    
    // 1. Extração Segura do Contexto (Multi-tenant)
    const userId = req.user ? req.user.id : 'anonymous';
    const schoolId = req.user ? (req.user.school_id || req.user.schoolId) : null;

    console.log(`\n🔵 [RAG AGENT] Nova requisição recebida.`);
    console.log(`👤 User: ${userId} | 🏫 School: ${schoolId}`);

    // 2. Timeout Estendido para Operações de RAG + LLM (60s)
    // RAG e geração de código podem levar tempo.
    res.setTimeout(60000, () => {
        console.error('❌ [CONTROLLER] Timeout (60s) atingido.');
        if (!res.headersSent) {
            res.status(504).json({ success: false, message: 'O processamento da IA demorou muito.' });
        }
    });

    try {
      const { question, history } = req.body;

      // Validações
      if (!question) {
        return res.status(400).json({ success: false, message: 'A pergunta (question) é obrigatória.' });
      }
      if (!schoolId) {
        return res.status(403).json({ success: false, message: 'Acesso negado: School ID não identificado.' });
      }

      // 3. Chamada ao Serviço RAG
      console.log(`📝 Pergunta: "${question}"`);
      const response = await AssistantService.processRequest(
          question, 
          history, 
          userId, 
          schoolId
      );

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ [CONTROLLER] Resposta gerada em ${duration}s`);

      return res.status(200).json({
        success: true,
        data: response // Resposta final processada
      });

    } catch (error) {
      console.error('❌ [CONTROLLER] Erro fatal:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro interno no processamento da IA.',
        error: error.message
      });
    }
  }
}

module.exports = new AssistantController();