const periodoService = require('../services/periodo.service'); // (minúsculo)

class PeriodoController {

    async create(req, res) {
        try {
            const periodo = await periodoService.create(req.body);
            res.status(201).json(periodo);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    async getAll(req, res) {
        try {
            const periodos = await periodoService.find(req.query);
            res.status(200).json(periodos);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    async getById(req, res) {
        try {
            const periodo = await periodoService.findById(req.params.id);
            res.status(200).json(periodo);
        } catch (error) {
            res.status(404).json({ message: error.message });
        }
    }

    async update(req, res) {
        try {
            const periodo = await periodoService.update(req.params.id, req.body);
            res.status(200).json(periodo);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    async remove(req, res) {
        try {
            const result = await periodoService.delete(req.params.id);
            res.status(200).json(result);
        } catch (error) {
            res.status(404).json({ message: error.message });
        }
    }
}

module.exports = new PeriodoController();