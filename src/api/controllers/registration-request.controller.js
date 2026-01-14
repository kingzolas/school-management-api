const service = require('../services/registration-request.service');
const appEmitter = require('../../loaders/eventEmitter');

exports.createRequest = async (req, res) => {
    try {
        const result = await service.createPublicRequest(req.body);
        // Emite o evento para o WebSocket
        appEmitter.emit('registration:created', result);
        return res.status(201).json({ 
            message: 'Solicitação enviada com sucesso! Aguarde a aprovação.',
            requestId: result._id 
        });
    } catch (error) {
        console.error('Erro createRequest:', error);
        return res.status(500).json({ message: error.message || 'Erro ao processar solicitação.' });
    }
};

// [ALTERADO] Busca TODAS as solicitações (Pendente, Aprovado, Rejeitado)
exports.listAll = async (req, res) => {
    try {
        const { schoolId } = req.user;
        // Chama o método que busca tudo, sem filtro de status
        const requests = await service.listAllRequests(schoolId);
        return res.json(requests);
    } catch (error) {
        console.error('Erro listAll:', error);
        return res.status(500).json({ message: 'Erro ao buscar solicitações.' });
    }
};

exports.updateRequestData = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { schoolId } = req.user;
        const { studentData, tutorData } = req.body;

        const result = await service.updateRequestData(requestId, schoolId, studentData, tutorData);
        return res.json({ message: 'Dados da solicitação atualizados.', request: result });
    } catch (error) {
        console.error('Erro updateRequestData:', error);
        return res.status(400).json({ message: error.message || 'Erro ao atualizar dados.' });
    }
};

exports.approveRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { schoolId, id: userId } = req.user;
        const { finalStudentData, finalTutorData } = req.body;

        const result = await service.approveRequest(requestId, schoolId, userId, finalStudentData, finalTutorData);
        return res.json(result);
    } catch (error) {
        console.error('Erro approveRequest:', error);
        return res.status(400).json({ message: error.message || 'Erro ao aprovar matrícula.' });
    }
};

exports.rejectRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { reason } = req.body;
        const { schoolId, id: userId } = req.user;

        await service.rejectRequest(requestId, schoolId, userId, reason);
        return res.json({ message: 'Solicitação rejeitada.' });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Erro ao rejeitar.' });
    }
};