const NegotiationService = require('../services/negotiation.service');

class NegotiationController {

    /**
     * (Gestor) Cria uma nova proposta de negociação.
     */
    async createNegotiation(req, res, next) {
        try {
            let { studentId, invoiceIds, rules } = req.body;
            
            // [NOVO] Captura os IDs do usuário autenticado
            const schoolId = req.user.school_id; 
            const createdByUserId = req.user.id;

            if (!schoolId || !createdByUserId) {
                return res.status(403).json({ message: 'Falha na autenticação: ID da escola ou usuário não encontrado no token.' });
            }

            if (typeof rules === 'string') {
                try {
                    rules = JSON.parse(rules);
                } catch (e) {
                    return res.status(400).json({ message: 'Formato de regras inválido.' });
                }
            }

            const negotiationData = { studentId, invoiceIds, rules };

            // [MODIFICADO] Passa schoolId e createdByUserId para o Service
            const newNegotiation = await NegotiationService.createNegotiation(
                negotiationData, 
                schoolId, 
                createdByUserId
            );

            const responsePayload = {
                message: 'Negociação criada com sucesso! Link será enviado.',
                linkToken: newNegotiation.token,
                negotiation: newNegotiation,
            };

            res.status(201).json(responsePayload);
            
        } catch (error) {
            console.error('❌ [BACKEND] Erro fatal em createNegotiation:', error);
            res.status(500).json({ message: error.message || 'Erro interno ao criar negociação.' });
        }
    }

    /**
     * (Gestor) Lista histórico por aluno, garantindo que o aluno esteja na escola.
     */
    async listByStudent(req, res, next) {
        try {
            const { studentId } = req.params;
            const schoolId = req.user.school_id; // [NOVO] Captura schoolId
            
            // [MODIFICADO] Passa schoolId para o Service
            const negotiations = await NegotiationService.listByStudent(studentId, schoolId); 
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
          if (error.message.includes('inválido') || error.message.includes('expirado') || error.message.includes('paga') || error.message.includes('não confere')) {
            return res.status(403).json({ message: error.message });
          }
          if (error.message.includes('encontrada')) {
            return res.status(404).json({ message: error.message });
          }
          res.status(500).json({ message: error.message || 'Erro interno na validação.' });
        }
    }

    async generatePayment(req, res, next) {
        try {
          const { token } = req.params;
          const { method, cardData } = req.body; 
      
          if (!method) {
            return res.status(400).json({ message: 'Método de pagamento é obrigatório.' });
          }
      
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