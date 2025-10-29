const Evento = require('../models/evento.model');
const mongoose = require('mongoose');

// População padrão para retornar dados úteis (quem criou, qual matéria, etc.)
const defaultPopulation = [
    { path: 'classId', select: 'name schoolYear' },
    { path: 'subjectId', select: 'name level' },
    { path: 'teacherId', select: 'fullName' }
];

class EventoService {

    /**
     * Cria um novo evento (singular).
     */
    async createEvento(eventoData) {
        try {
            const newEvento = new Evento(eventoData);
            await newEvento.save();
            await newEvento.populate(defaultPopulation);
            return newEvento;
        } catch (error) {
            // Lança erros de validação (ex: campos 'title' ou 'date' faltando)
            throw error;
        }
    }

    /**
     * [NOVO] Cria múltiplos eventos (em lote).
     */
    async createMultipleEventos(eventosData) {
        if (!Array.isArray(eventosData) || eventosData.length === 0) {
            throw new Error('Dados de entrada inválidos. Um array de eventos é esperado.');
        }

        let createdEventos = [];
        try {
            // Tenta inserir todos. { ordered: false } ignora erros de duplicata e continua.
            createdEventos = await Evento.insertMany(eventosData, { ordered: false });
            
            // Popula os documentos recém-criados
            const createdIds = createdEventos.map(e => e._id);
            const populatedEventos = await Evento.find({ _id: { $in: createdIds } })
                                                 .populate(defaultPopulation);
            return populatedEventos;

        } catch (error) {
            // Se 'ordered: false' encontra duplicatas, ele lança um MongoBulkWriteError
            if (error.name === 'MongoBulkWriteError' && error.code === 11000) {
                console.warn('Aviso de BulkWrite: Alguns eventos duplicados foram ignorados.');
                
                // Se ALGUNS foram inseridos mesmo com o erro
                if (error.result && error.result.insertedIds && error.result.insertedIds.length > 0) {
                    const insertedIds = error.result.insertedIds.map(doc => doc._id);
                    const populated = await Evento.find({ _id: { $in: insertedIds } }).populate(defaultPopulation);
                    return populated;
                }
                // Se NENHUM foi inserido (todos duplicados)
                return []; 
            }
            // Lança outros erros (ex: validação de 'eventType' falhou)
            throw error;
        }
    }

    /**
     * Busca eventos com base em filtros complexos (para o calendário).
     */
    async getAllEventos(filter = {}) {
        let query = {};
        
        // --- 1. Filtro de Data (Obrigatório para performance) ---
        const dateFilter = {};
        if (filter.startDate) {
            dateFilter.$gte = new Date(filter.startDate); // Maior ou igual (data de início)
        }
        if (filter.endDate) {
            dateFilter.$lte = new Date(filter.endDate); // Menor ou igual (data de fim)
        }
        if (Object.keys(dateFilter).length > 0) {
            query.date = dateFilter;
        }

        // --- 2. Filtro de Contexto (Turma OU Escola) ---
        // Pega eventos da Turma OU eventos da Escola (isSchoolWide)
        const contextFilter = [];
        if (filter.classId) {
            contextFilter.push({ classId: filter.classId });
        }
        if (filter.isSchoolWide === 'true') {
            contextFilter.push({ isSchoolWide: true });
        }

        if (contextFilter.length > 0) {
            query.$or = contextFilter;
        }

        // Se 'isSchoolWide' e 'classId' não forem passados, busca TUDO no range de data.
        
        console.log('[EventoService.getAll] Query:', JSON.stringify(query));
        
        return await Evento.find(query)
            .populate(defaultPopulation)
            .sort({ date: 1, startTime: 1 }); // Ordena por data e hora
    }

    /**
     * Busca um evento específico por ID.
     */
    async getEventoById(id) {
        const evento = await Evento.findById(id).populate(defaultPopulation);
        if (!evento) {
            throw new Error('Evento não encontrado.');
        }
        return evento;
    }

    /**
     * Atualiza um evento.
     */
    async updateEvento(id, updateData) {
        const updatedEvento = await Evento.findByIdAndUpdate(id, updateData, {
            new: true,
            runValidators: true
        }).populate(defaultPopulation);

        if (!updatedEvento) {
            throw new Error('Evento não encontrado para atualizar.');
        }
        return updatedEvento;
    }

    /**
     * Deleta um evento.
     */
    async deleteEvento(id) {
        const deletedEvento = await Evento.findByIdAndDelete(id).populate(defaultPopulation);
        if (!deletedEvento) {
            throw new Error('Evento não encontrado para deletar.');
        }
        return deletedEvento;
    }
}

module.exports = new EventoService();