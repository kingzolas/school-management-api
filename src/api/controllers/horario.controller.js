const HorarioService = require('../services/horario.service');
const appEmitter = require('../../loaders/eventEmitter'); // Seu emissor global

class HorarioController {

    /**
     * [NOVO] Cria múltiplos horários (em lote).
     */
    async createBulk(req, res, next) {
        // O body deve ser um array de objetos de horário: [ {...}, {...} ]
        const horariosData = req.body; 

        if (!Array.isArray(horariosData) || horariosData.length === 0) {
            return res.status(400).json({ message: 'O corpo da requisição deve conter um array de horários.' });
        }

        try {
            const createdHorarios = await HorarioService.createMultipleHorarios(horariosData);

            // Emite um evento WebSocket para CADA horário criado
            createdHorarios.forEach(horario => {
                appEmitter.emit('horario:created', horario);
                console.log(`📡 EVENTO EMITIDO (Lote): horario:created para ${horario.classId.name}`);
            });

            res.status(201).json({
                message: `${createdHorarios.length} de ${horariosData.length} aulas foram criadas com sucesso (duplicatas ignoradas).`,
                createdHorarios
            });
        } catch (error) {
            console.error('❌ ERRO [HorarioController.createBulk]:', error.message);
            // Retorna o erro de validação (ex: Professor não habilitado)
            res.status(400).json({ message: error.message });
            // next(error); // Alternativa
        }
    }

    async create(req, res, next) {
        try {
            // O body deve conter classId, subjectId, teacherId, dayOfWeek, etc.
            const newHorario = await HorarioService.createHorario(req.body);
            
            // Emite o evento com o horário populado
            appEmitter.emit('horario:created', newHorario);
            console.log(`📡 EVENTO EMITIDO: horario:created para turma ${newHorario.classId.name}`);
            
            res.status(201).json(newHorario);
        } catch (error) {
            console.error('❌ ERRO [HorarioController.create]:', error.message);
            // Trata erros específicos do service
            if (error.message.includes('habilitado') || error.message.includes('Conflito')) {
                return res.status(400).json({ message: error.message }); // 400 Bad Request
            }
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message }); // 404 Not Found
            }
            next(error); 
        }
    }

    async getAll(req, res, next) {
        try {
            // Permite filtrar por ?classId=... ou ?teacherId=...
            const horarios = await HorarioService.getHorarios(req.query);
            res.status(200).json(horarios);
        } catch (error) {
            console.error('❌ ERRO [HorarioController.getAll]:', error.message);
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const horario = await HorarioService.getHorarioById(req.params.id);
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
            const updatedHorario = await HorarioService.updateHorario(req.params.id, req.body);
            
            appEmitter.emit('horario:updated', updatedHorario);
            console.log(`📡 EVENTO EMITIDO: horario:updated para ID ${updatedHorario._id}`);
            
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
            const deletedHorario = await HorarioService.deleteHorario(req.params.id);
            
            // Emite o documento deletado (populado)
            appEmitter.emit('horario:deleted', deletedHorario); 
            console.log(`📡 EVENTO EMITIDO: horario:deleted para ID ${req.params.id}`);
            
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