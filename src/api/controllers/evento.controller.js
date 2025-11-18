// src/api/controllers/evento.controller.js
const EventoService = require('../services/evento.service');
const appEmitter = require('../../loaders/eventEmitter'); 

class EventoController {

    async create(req, res, next) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura o schoolId
            
            // [MODIFICADO] Passa o schoolId para o Service
            const newEvento = await EventoService.createEvento(req.body, schoolId);
            
            appEmitter.emit('evento:created', newEvento);
            
            res.status(201).json(newEvento);
        } catch (error) {
            console.error('❌ ERRO [EventoController.create]:', error.message);
            // Trata erro de referência da escola
             if (error.message.includes('não pertence à sua escola')) {
                return res.status(403).json({ message: error.message });
            }
            next(error); 
        }
    }

    async createBulk(req, res, next) {
        const eventosData = req.body; 
        const schoolId = req.user.school_id; // [NOVO] Captura o schoolId

        if (!Array.isArray(eventosData) || eventosData.length === 0) {
            return res.status(400).json({ message: 'O corpo da requisição deve conter um array de eventos.' });
        }

        try {
            // [MODIFICADO] Passa o schoolId para o Service
            const createdEventos = await EventoService.createMultipleEventos(eventosData, schoolId);

            createdEventos.forEach(evento => {
                appEmitter.emit('evento:created', evento);
            });

            res.status(201).json({
                message: `${createdEventos.length} de ${eventosData.length} eventos foram criados com sucesso (duplicatas ignoradas).`,
                createdEventos
            });
        } catch (error) {
            console.error('❌ ERRO [EventoController.createBulk]:', error.message);
            if (error.message.includes('não pertence à sua escola')) {
                 return res.status(403).json({ message: error.message });
            }
            next(error);
        }
    }

    async getAll(req, res, next) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura o schoolId
            
            // [MODIFICADO] Passa o schoolId para o Service
            const eventos = await EventoService.getAllEventos(req.query, schoolId);
            res.status(200).json(eventos);
        } catch (error) {
            console.error('❌ ERRO [EventoController.getAll]:', error.message);
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura o schoolId
            
            // [MODIFICADO] Passa o schoolId para o Service
            const evento = await EventoService.getEventoById(req.params.id, schoolId);
            
            res.status(200).json(evento);
        } catch (error) {
            console.error(`❌ ERRO [EventoController.getById ${req.params.id}]:`, error.message);
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
            const updatedEvento = await EventoService.updateEvento(req.params.id, req.body, schoolId);
            
            appEmitter.emit('evento:updated', updatedEvento);
            
            res.status(200).json(updatedEvento);
        } catch (error) {
            console.error(`❌ ERRO [EventoController.update ${req.params.id}]:`, error.message);
             if (error.message.includes('não pertence à sua escola') || error.message.includes('não encontrado para atualizar')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async delete(req, res, next) {
        try {
            const schoolId = req.user.school_id; // [NOVO] Captura o schoolId
            
            // [MODIFICADO] Passa o schoolId para o Service
            const deletedEvento = await EventoService.deleteEvento(req.params.id, schoolId);
            
            appEmitter.emit('evento:deleted', deletedEvento); 
            
            res.status(200).json({ message: 'Evento deletado com sucesso', deletedEvento });
        } catch (error) {
            console.error(`❌ ERRO [EventoController.delete ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }
}

module.exports = new EventoController();