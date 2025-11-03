console.log('--- 2. [Controller] Carregando schoolyear.controller.js ---');

// LINHA CRÍTICA DE IMPORTAÇÃO (Service)
const schoolYearService = require('../services/schoolyear.service');

class SchoolYearController {
    
    async create(req, res) {
        try {
            const data = { ...req.body };
            // data.schoolId = req.user.schoolId; // Adicione se o ID da escola vier do auth
            
            const schoolYear = await schoolYearService.create(data);
            res.status(201).json(schoolYear);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    async getAll(req, res) {
        try {
            const schoolYears = await schoolYearService.find(req.query);
            res.status(200).json(schoolYears);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    async getById(req, res) {
        try {
            const schoolYear = await schoolYearService.findById(req.params.id);
            res.status(200).json(schoolYear);
        } catch (error) {
            res.status(404).json({ message: error.message });
        }
    }

    async update(req, res) {
        try {
            const schoolYear = await schoolYearService.update(req.params.id, req.body);
            res.status(200).json(schoolYear);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    async remove(req, res) {
        try {
            const result = await schoolYearService.delete(req.params.id);
            res.status(200).json(result);
        } catch (error) {
            res.status(404).json({ message: error.message });
        }
    }
}

// LINHA CRÍTICA DE EXPORTAÇÃO
module.exports = new SchoolYearController();