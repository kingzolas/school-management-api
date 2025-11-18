// src/api/controllers/horario.controller.js
const HorarioService = require('../services/horario.service');
const appEmitter = require('../../loaders/eventEmitter'); 

class HorarioController {

    async createBulk(req, res, next) {
        const horariosData = req.body; 
        const schoolId = req.user.school_id; // [NOVO] Captura o schoolId

        if (!Array.isArray(horariosData) || horariosData.length === 0) {
            return res.status(400).json({ message: 'O corpo da requisição deve conter um array de horários.' });
        }

        try {
            // [MODIFICADO] Passa o schoolId para o Service
            const createdHorarios = await HorarioService.createMultipleHorarios(horariosData, schoolId);

            createdHorarios.forEach(horario => {
                appEmitter.emit('horario:created', horario);
            });

            res.status(201).json({
                message: `${createdHorarios.length} de ${horariosData.length} aulas foram criadas com sucesso (duplicatas ignoradas).`,
                createdHorarios
            });
        } catch (error) {
            console.error('❌ ERRO [HorarioController.createBulk]:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async create(req, res, next) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura o schoolId
            
            // [MODIFICADO] Passa o schoolId para o Service
            const newHorario = await HorarioService.createHorario(req.body, schoolId);
            
            appEmitter.emit('horario:created', newHorario);
            
            res.status(201).json(newHorario);
        } catch (error) {
            console.error('❌ ERRO [HorarioController.create]:', error.message);
            if (error.message.includes('habilitado') || error.message.includes('Conflito')) {
                return res.status(400).json({ message: error.message });
            }
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error); 
        }
    }

    async getAll(req, res, next) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura o schoolId
            
            // [MODIFICADO] Passa o schoolId para o Service
            const horarios = await HorarioService.getHorarios(req.query, schoolId);
            res.status(200).json(horarios);
        } catch (error) {
            console.error('❌ ERRO [HorarioController.getAll]:', error.message);
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura o schoolId
            
            // [MODIFICADO] Passa o schoolId para o Service
            const horario = await HorarioService.getHorarioById(req.params.id, schoolId);
            
            res.status(200).json(horario);
        } catch (error) {
            console.error(`❌ ERRO [HorarioController.getById ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura o schoolId
            
            // [MODIFICADO] Passa o schoolId para o Service
            const updatedHorario = await HorarioService.updateHorario(req.params.id, req.body, schoolId);
            
            appEmitter.emit('horario:updated', updatedHorario);
            
            res.status(200).json(updatedHorario);
        } catch (error) {
            console.error(`❌ ERRO [HorarioController.update ${req.params.id}]:`, error.message);
            if (error.message.includes('habilitado') || error.message.includes('Conflito')) {
                return res.status(400).json({ message: error.message });
            }
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async delete(req, res, next) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura o schoolId
            
            // [MODIFICADO] Passa o schoolId para o Service
            const deletedHorario = await HorarioService.deleteHorario(req.params.id, schoolId);
            
            appEmitter.emit('horario:deleted', deletedHorario); 
            
            res.status(200).json({ message: 'Horário deletado com sucesso', deletedHorario });
        } catch (error) {
            console.error(`❌ ERRO [HorarioController.delete ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }
}

module.exports = new HorarioController();