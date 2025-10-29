const EventoService = require('../services/evento.service');
const appEmitter = require('../../loaders/eventEmitter'); // Seu emissor global

class EventoController {

    async create(req, res, next) {
        try {
            // Opcional: Adicionar quem criou o evento vindo do token
            // const eventoData = { ...req.body, teacherId: req.user.id };
            const newEvento = await EventoService.createEvento(req.body);
            
            appEmitter.emit('evento:created', newEvento);
            console.log(`📡 EVENTO EMITIDO: evento:created para ${newEvento.title}`);
            
            res.status(201).json(newEvento);
        } catch (error) {
            console.error('❌ ERRO [EventoController.create]:', error.message);
            next(error); 
        }
    }

    /**
     * [NOVO] Cria múltiplos eventos (em lote).
     */
    async createBulk(req, res, next) {
        // Espera um body que é um array: [ {...}, {...} ]
        const eventosData = req.body; 

        if (!Array.isArray(eventosData) || eventosData.length === 0) {
            return res.status(400).json({ message: 'O corpo da requisição deve conter um array de eventos.' });
        }

        try {
            const createdEventos = await EventoService.createMultipleEventos(eventosData);

            // Emite um evento WebSocket para CADA evento criado
            createdEventos.forEach(evento => {
                appEmitter.emit('evento:created', evento);
                console.log(`📡 EVENTO EMITIDO (Lote): evento:created para ${evento.title}`);
            });

            res.status(201).json({
                message: `${createdEventos.length} de ${eventosData.length} eventos foram criados com sucesso (duplicatas ignoradas).`,
                createdEventos
            });
        } catch (error) {
            console.error('❌ ERRO [EventoController.createBulk]:', error.message);
            next(error);
        }
    }

    async getAll(req, res, next) {
        try {
            // Filtros: ?classId=...&startDate=...&endDate=...&isSchoolWide=true
            const eventos = await EventoService.getAllEventos(req.query);
            res.status(200).json(eventos);
        } catch (error) {
            console.error('❌ ERRO [EventoController.getAll]:', error.message);
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const evento = await EventoService.getEventoById(req.params.id);
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
            const updatedEvento = await EventoService.updateEvento(req.params.id, req.body);
            appEmitter.emit('evento:updated', updatedEvento);
            console.log(`📡 EVENTO EMITIDO: evento:updated para ID ${updatedEvento._id}`);
            res.status(200).json(updatedEvento);
        } catch (error) {
            console.error(`❌ ERRO [EventoController.update ${req.params.id}]:`, error.message);
             if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async delete(req, res, next) {
        try {
            const deletedEvento = await EventoService.deleteEvento(req.params.id);
            appEmitter.emit('evento:deleted', deletedEvento); 
            console.log(`📡 EVENTO EMITIDO: evento:deleted para ID ${req.params.id}`);
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