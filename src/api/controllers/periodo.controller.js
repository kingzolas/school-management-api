const periodoService = require('../services/periodo.service'); 

class PeriodoController {

    async create(req, res) {
        try {
            const schoolId = req.user.school_id; // Pega do Token
            const periodo = await periodoService.create(req.body, schoolId);
            res.status(201).json(periodo);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    async getAll(req, res) {
        try {
            const schoolId = req.user.school_id;
            const periodos = await periodoService.find(req.query, schoolId);
            res.status(200).json(periodos);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    async getById(req, res) {
        try {
            const schoolId = req.user.school_id;
            const periodo = await periodoService.findById(req.params.id, schoolId);
            res.status(200).json(periodo);
        } catch (error) {
            res.status(404).json({ message: error.message });
        }
    }

    async update(req, res) {
        try {
            const schoolId = req.user.school_id;
            const periodo = await periodoService.update(req.params.id, req.body, schoolId);
            res.status(200).json(periodo);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    async remove(req, res) {
        try {
            const schoolId = req.user.school_id;
            const result = await periodoService.delete(req.params.id, schoolId);
            res.status(200).json(result);
        } catch (error) {
            res.status(404).json({ message: error.message });
        }
    }
}

module.exports = new PeriodoController();