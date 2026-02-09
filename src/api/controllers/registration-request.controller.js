const service = require('../services/registration-request.service');
const appEmitter = require('../../loaders/eventEmitter');

// --- [NOVO] Função Auxiliar para Normalizar Parentesco ---
const normalizeRelationship = (tutors) => {
    if (!tutors || !Array.isArray(tutors)) return tutors;
    
    const mapRel = {
        'pai': 'Pai',
        'mãe': 'Mãe', 'mae': 'Mãe',
        'avó': 'Avó/Avô', 'avô': 'Avó/Avô', 'avo': 'Avó/Avô',
        'tio': 'Tio/Tia', 'tia': 'Tio/Tia',
        'conjuge': 'Cônjuge', 'cônjuge': 'Cônjuge',
        'outro': 'Outro'
    };

    return tutors.map(t => {
        if (t.relationship) {
            const lower = t.relationship.toLowerCase().trim();
            if (mapRel[lower]) {
                t.relationship = mapRel[lower];
            } else {
                // Capitaliza primeira letra se não achar no mapa
                t.relationship = t.relationship.charAt(0).toUpperCase() + t.relationship.slice(1).toLowerCase();
            }
        }
        return t;
    });
};
// ---------------------------------------------------------

exports.createRequest = async (req, res) => {
    try {
        const result = await service.createPublicRequest(req.body);
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

exports.listAll = async (req, res) => {
    try {
        const { schoolId } = req.user;
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
        let { finalStudentData, finalTutorData } = req.body;

        // [CORREÇÃO] Sanitização preventiva no Controller
        if (finalStudentData && finalStudentData.tutors) {
            finalStudentData.tutors = normalizeRelationship(finalStudentData.tutors);
        }

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