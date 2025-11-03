const cargaHorariaService = require('../services/cargaHoraria.service');

class CargaHorariaController {
    
    async create(req, res) {
        try {
            const carga = await cargaHorariaService.create(req.body);
            res.status(201).json(carga);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    async getAll(req, res) {
        try {
            // Ex: /api/carga-horaria?classId=...&termId=...
            const cargas = await cargaHorariaService.find(req.query);
            res.status(200).json(cargas);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    async update(req, res) {
        try {
            const carga = await cargaHorariaService.update(req.params.id, req.body);
            res.status(200).json(carga);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    async remove(req, res) {
        try {
            const result = await cargaHorariaService.delete(req.params.id);
            res.status(200).json(result);
        } catch (error) {
            res.status(404).json({ message: error.message });
        }
    }
}

module.exports = new CargaHorariaController();