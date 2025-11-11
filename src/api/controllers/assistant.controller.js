// src/api/controllers/assistant.controller.js
const assistantService = require('../services/assistant.service.js');

class AssistantController {
  async handleChat(req, res) {
    try {
      // O front-end enviará a mensagem atual e o histórico
      const { message, history } = req.body;
      
      // O ID do usuário vem do token verificado pelo middleware
      const userId = req.user.id; 

      if (!message) {
        return res.status(400).json({ error: 'A mensagem é obrigatória.' });
      }

      // Chama o serviço (o cérebro) para processar
      const responseText = await assistantService.generateResponse(message, history || [], userId);
      
      // Retorna a resposta de texto simples para o front-end
      res.json({ response: responseText });

    } catch (error) {
      console.error('Erro no AssistantController:', error);
      res.status(500).json({ error: 'Falha ao processar a mensagem do chat.' });
    }
  }
}

module.exports = new AssistantController();