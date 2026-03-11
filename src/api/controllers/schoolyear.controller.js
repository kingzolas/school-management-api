const schoolYearService = require('../services/schoolyear.service');

class SchoolYearController {
    
    async create(req, res) {
        try {
            const schoolId = req.user.school_id; 
            const data = req.body;
            
            console.log(`[SchoolYearController] Requisição de criação recebida para escola: ${schoolId}`);
            
            const schoolYear = await schoolYearService.create(data, schoolId);
            res.status(201).json(schoolYear);
        } catch (error) {
            console.error(`[SchoolYearController] Erro no Create: ${error.message}`);
            // Retorna 409 Conflict se for erro de duplicidade
            const isConflict = error.message.includes('já está cadastrado') || error.message.includes('duplicidade');
            const status = isConflict ? 409 : 400;
            res.status(status).json({ message: error.message });
        }
    }

    async getAll(req, res) {
        try {
            const schoolId = req.user.school_id;
            const schoolYears = await schoolYearService.find(req.query, schoolId);
            res.status(200).json(schoolYears);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    async getById(req, res) {
        try {
            const schoolId = req.user.school_id;
            const schoolYear = await schoolYearService.findById(req.params.id, schoolId);
            res.status(200).json(schoolYear);
        } catch (error) {
            res.status(404).json({ message: error.message });
        }
    }

    async update(req, res) {
        try {
            const schoolId = req.user.school_id;
            const schoolYear = await schoolYearService.update(req.params.id, req.body, schoolId);
            res.status(200).json(schoolYear);
        } catch (error) {
            const status = error.message.includes('não encontrado') ? 404 : 400;
            res.status(status).json({ message: error.message });
        }
    }

    async remove(req, res) {
        try {
            const schoolId = req.user.school_id;
            const result = await schoolYearService.delete(req.params.id, schoolId);
            res.status(200).json(result);
        } catch (error) {
            res.status(404).json({ message: error.message });
        }
    }
}

module.exports = new SchoolYearController();