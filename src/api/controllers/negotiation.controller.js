const NegotiationService = require('../services/negotiation.service');

class NegotiationController {

  /**
   * (Gestor) Cria uma nova proposta de negociação.
   */
async createNegotiation(req, res, next) {
    try {
      console.log('--- 📥 [BACKEND] createNegotiation chamado ---');
      console.log('Body recebido:', JSON.stringify(req.body, null, 2));

      let { studentId, invoiceIds, rules } = req.body;
      const createdByUserId = req.user ? req.user.id : null;

      // Log para ver se rules chegou como string ou objeto
      console.log('Tipo de "rules":', typeof rules);

      if (typeof rules === 'string') {
        console.log('⚠️ "rules" é string. Fazendo parse...');
        try {
            rules = JSON.parse(rules);
        } catch (e) {
            console.error('❌ Erro ao fazer parse de rules:', e);
            return res.status(400).json({ message: 'Formato de regras inválido.' });
        }
      }

      const negotiationData = {
        studentId,
        invoiceIds,
        rules,
        createdByUserId,
      };

      const newNegotiation = await NegotiationService.createNegotiation(negotiationData);

      const responsePayload = {
        message: 'Negociação criada com sucesso! Link será enviado.',
        linkToken: newNegotiation.token, // Garantindo que o token está aqui
        negotiation: newNegotiation,
      };

      console.log('--- 📤 [BACKEND] Respondendo para o Flutter ---');
      // Logamos apenas as chaves para não poluir, mas logamos o linkToken
      console.log('Keys:', Object.keys(responsePayload));
      console.log('Token enviado:', responsePayload.linkToken);

      res.status(201).json(responsePayload);
      
    } catch (error) {
      console.error('❌ [BACKEND] Erro fatal:', error);
      res.status(500).json({ message: error.message || 'Erro interno ao criar negociação.' });
    }
  }

  // ... (Mantenha os outros métodos listByStudent, validateAccess, etc. iguais ao anterior)
  async listByStudent(req, res, next) {
    try {
      const { studentId } = req.params;
      const negotiations = await NegotiationService.listByStudent(studentId);
      res.status(200).json(negotiations);
    } catch (error) {
      console.error('Erro em NegotiationController.listByStudent:', error.message);
      res.status(500).json({ message: error.message || 'Erro ao buscar histórico.' });
    }
  }

  async validateAccess(req, res, next) {
    try {
      const { token } = req.params;
      const { cpf } = req.body;

      if (!cpf) return res.status(400).json({ message: 'CPF é obrigatório.' });

      const validationData = await NegotiationService.validateAccess(token, cpf);

      res.status(200).json({
        message: 'Validação bem-sucedida.',
        data: validationData,
      });
    } catch (error) {
      console.error('Erro em NegotiationController.validateAccess:', error.message);
      if (error.message.includes('inválido') || error.message.includes('expirado')) {
        return res.status(403).json({ message: error.message });
      }
      if (error.message.includes('encontrada')) {
        return res.status(404).json({ message: error.message });
      }
      res.status(500).json({ message: error.message || 'Erro interno na validação.' });
    }
  }
// negotiation.controller.js

async generatePayment(req, res, next) {
  try {
    const { token } = req.params;
    // cardData é um objeto com: { token, issuerId, paymentMethodId, installments }
    const { method, cardData } = req.body; 

    if (!method) {
      return res.status(400).json({ message: 'Método de pagamento é obrigatório.' });
    }

    // Passamos o cardData para o serviço
    const paymentResponse = await NegotiationService.generatePayment(token, method, cardData);

    res.status(200).json({
      message: 'Processamento realizado.',
      paymentData: paymentResponse, 
    });
  } catch (error) {
    console.error('Erro em NegotiationController.generatePayment:', error.message);
    res.status(500).json({ message: error.message || 'Erro ao gerar pagamento.' });
  }
}

  async getNegotiationStatus(req, res, next) {
    try {
      const { token } = req.params;
      const status = await NegotiationService.getStatus(token);
      res.status(200).json({ status });
    } catch (error) {
      console.error('Erro em NegotiationController.getNegotiationStatus:', error.message);
      res.status(500).json({ message: error.message || 'Erro ao consultar status.' });
    }
  }
}

module.exports = new NegotiationController();