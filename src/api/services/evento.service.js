// src/api/services/evento.service.js
const Evento = require('../models/evento.model');
const mongoose = require('mongoose');
const Class = require('../models/class.model'); // Necessário para validação

const defaultPopulation = [
    { path: 'classId', select: 'name schoolYear' },
    { path: 'subjectId', select: 'name level' },
    { path: 'teacherId', select: 'fullName' }
];

class EventoService {

    /**
     * [NOVO] Valida se as referências (Turma/Disciplina) pertencem à escola.
     */
    async _validateReferences(eventoData, schoolId) {
        if (eventoData.classId) {
            const classExists = await Class.findOne({ _id: eventoData.classId, school_id: schoolId });
            if (!classExists) {
                throw new Error('Turma informada não encontrada ou não pertence à sua escola.');
            }
        }
        // [OPCIONAL] Adicionar validação de Subject/Teacher/Term aqui, se necessário.
    }

    /**
     * Cria um novo evento (singular).
     */
    async createEvento(eventoData, schoolId) { // [MODIFICADO] Recebe schoolId
        const dataToCreate = { 
            ...eventoData, 
            school_id: schoolId // Garante a vinculação
        };

        await this._validateReferences(dataToCreate, schoolId); // Valida referências

        try {
            const newEvento = new Evento(dataToCreate);
            await newEvento.save();
            await newEvento.populate(defaultPopulation);
            return newEvento;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Cria múltiplos eventos (em lote).
     */
    async createMultipleEventos(eventosData, schoolId) { // [MODIFICADO] Recebe schoolId
        if (!Array.isArray(eventosData) || eventosData.length === 0) {
            throw new Error('Dados de entrada inválidos.');
        }
        
        const eventosWithSchool = eventosData.map(e => ({ 
            ...e, 
            school_id: schoolId // Injeta o ID da escola
        }));

        // 1. Pré-validação de todas as referências (classId, etc.)
        for (const evento of eventosWithSchool) {
            await this._validateReferences(evento, schoolId);
        }

        let createdEventos = [];
        try {
            createdEventos = await Evento.insertMany(eventosWithSchool, { ordered: false });
            
            const createdIds = createdEventos.map(e => e._id);
            const populatedEventos = await Evento.find({ _id: { $in: createdIds } })
                                                   .populate(defaultPopulation);
            return populatedEventos;

        } catch (error) {
            if (error.name === 'MongoBulkWriteError' && error.code === 11000) {
                console.warn('Aviso de BulkWrite: Alguns eventos duplicados foram ignorados.');
                if (error.result && error.result.insertedIds && error.result.insertedIds.length > 0) {
                    const insertedIds = error.result.insertedIds.map(doc => doc._id);
                    const populated = await Evento.find({ _id: { $in: insertedIds } }).populate(defaultPopulation);
                    return populated;
                }
                return []; 
            }
            throw error;
        }
    }

    /**
     * Busca eventos com base em filtros complexos (para o calendário), LIMITADO PELA ESCOLA.
     */
    async getAllEventos(filter = {}, schoolId) { // [MODIFICADO] Recebe schoolId
        let query = {};
        
        // --- 1. Filtro de Data (Obrigatório para performance) ---
        const dateFilter = {};
        if (filter.startDate) {
            dateFilter.$gte = new Date(filter.startDate); 
        }
        if (filter.endDate) {
            dateFilter.$lte = new Date(filter.endDate); 
        }
        if (Object.keys(dateFilter).length > 0) {
            query.date = dateFilter;
        }

        // --- 2. Filtro de Contexto (Turma OU Escola) ---
        const contextFilter = [];
        if (filter.classId) {
            contextFilter.push({ classId: filter.classId });
        }
        if (filter.isSchoolWide === 'true' || filter.isSchoolWide === true) {
            contextFilter.push({ isSchoolWide: true });
        }

        if (contextFilter.length > 0) {
            query.$or = contextFilter;
        }
        
        // --- 3. [NOVO] FILTRO PRINCIPAL: ISOLAMENTO POR ESCOLA ---
        query.school_id = schoolId;
        
        console.log('[EventoService.getAll] Query Final:', JSON.stringify(query));
        
        return await Evento.find(query)
            .populate(defaultPopulation)
            .sort({ date: 1, startTime: 1 });
    }

    /**
     * Busca um evento específico por ID, limitado pela escola.
     */
    async getEventoById(id, schoolId) { // [MODIFICADO] Recebe schoolId
        const evento = await Evento.findOne({ _id: id, school_id: schoolId }).populate(defaultPopulation);

        if (!evento) {
            throw new Error('Evento não encontrado ou não pertence à sua escola.');
        }
        return evento;
    }

    /**
     * Atualiza um evento.
     */
    async updateEvento(id, updateData, schoolId) { // [MODIFICADO] Recebe schoolId
        // 1. Validação de segurança: o evento deve pertencer à escola
        const existingEvento = await Evento.findOne({ _id: id, school_id: schoolId });
        if (!existingEvento) {
            throw new Error('Evento não encontrado para atualizar ou não pertence à sua escola.');
        }

        // 2. Validação de referências (Se Turma/Disciplina mudar)
        if (updateData.classId) {
             await this._validateReferences(updateData, schoolId);
        }

        // Garante que o school_id não pode ser alterado
        delete updateData.school_id;

        const updatedEvento = await Evento.findOneAndUpdate(
            { _id: id, school_id: schoolId }, // Query de segurança
            updateData, 
            { new: true, runValidators: true }
        ).populate(defaultPopulation);

        if (!updatedEvento) {
            // Este caso é improvável após a validação inicial, mas é um bom fallback
            throw new Error('Evento não encontrado para atualizar.'); 
        }
        return updatedEvento;
    }

    /**
     * Deleta um evento.
     */
    async deleteEvento(id, schoolId) { // [MODIFICADO] Recebe schoolId
        const deletedEvento = await Evento.findOneAndDelete({ _id: id, school_id: schoolId }).populate(defaultPopulation);
        if (!deletedEvento) {
            throw new Error('Evento não encontrado para deletar ou não pertence à sua escola.');
        }
        return deletedEvento;
    }
}

module.exports = new EventoService();