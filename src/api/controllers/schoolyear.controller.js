const schoolYearService = require('../services/schoolyear.service');

class SchoolYearController {
    
    async create(req, res) {
        try {
            const schoolId = req.user.school_id; // Pega do Token
            const data = req.body;
            
            const schoolYear = await schoolYearService.create(data, schoolId);
            res.status(201).json(schoolYear);
        } catch (error) {
            // Retorna 409 Conflict se já existir
            const status = error.message.includes('já está cadastrado') ? 409 : 400;
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