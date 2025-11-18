// src/api/controllers/courseLoad.controller.js
const courseLoadService = require('../services/courseLoad.service.js');

class CourseLoadController {

    async find(req, res) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura schoolId
            const loads = await courseLoadService.find(req.query, schoolId); // [MODIFICADO] Passa schoolId
            res.status(200).json(loads);
        } catch (error) {
            console.error('❌ ERRO [CourseLoadController.find]:', error.message);
            res.status(500).json({ message: error.message });
        }
    }

    async batchSave(req, res) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura schoolId
            const { periodoId, classId, loads } = req.body;
            
            // [MODIFICADO] Passa schoolId para o service
            const result = await courseLoadService.batchSave(periodoId, classId, loads, schoolId); 
            
            res.status(200).json({ message: 'Matriz salva com sucesso.', result });
        } catch (error) {
            console.error('❌ ERRO [CourseLoadController.batchSave]:', error.message);
            // Erros de validação (ex: Turma não pertence) devem retornar 403/400
            if (error.message.includes('não pertence à sua escola')) {
                return res.status(403).json({ message: error.message });
            }
            res.status(500).json({ message: error.message });
        }
    }

    async create(req, res) {
        try {
            const schoolId = req.user.school_id;
            const newLoad = await courseLoadService.create(req.body, schoolId);
            res.status(201).json(newLoad);
        } catch (error) {
            // Conflito (409) ou Validação (400/403)
            const status = error.message.includes('Conflito') ? 409 : 400;
            res.status(status).json({ message: error.message });
        }
    }

    async update(req, res) {
        try {
            const schoolId = req.user.school_id;
            const updatedLoad = await courseLoadService.update(req.params.id, req.body, schoolId);
            res.status(200).json(updatedLoad);
        } catch (error) {
            if (error.message.includes('não encontrada') || error.message.includes('não pertence')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('Conflito')) {
                 return res.status(409).json({ message: error.message });
            }
            res.status(400).json({ message: error.message });
        }
    }
}

module.exports = new CourseLoadController();