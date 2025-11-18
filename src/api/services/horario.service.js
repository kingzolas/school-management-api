// src/api/services/horario.service.js
const Horario = require('../models/horario.model');
const User = require('../models/user.model');
const StaffProfile = require('../models/staffProfile.model');
const Subject = require('../models/subject.model');
const Class = require('../models/class.model');
const Term = require('../models/periodo.model'); // Importa o modelo Periodo como Term
const mongoose = require('mongoose');

const defaultPopulation = [
    { 
        path: 'teacherId',
        select: 'fullName email' 
    },
    { 
        path: 'subjectId',
        select: 'name level' 
    },
    {
        path: 'classId',
        select: 'name grade schoolYear' 
    },
    {
        path: 'termId', // [NOVO] Popula o Período
        select: 'titulo dataInicio dataFim' 
    }
];

class HorarioService {

    /**
     * Valida se todas as referências pertencem à escola do usuário E se o professor pode lecionar a disciplina.
     */
    async _validateReferences(data, schoolId) {
        const { teacherId, subjectId, classId, termId } = data;

        // 1. Valida Habilitação do Professor (já faz parte da validação anterior)
        await this._validateTeacherAbility(teacherId, subjectId);

        // 2. Valida Referências de Turma, Disciplina e Período (Scope Check)
        const [classExists, subjectExists, termExists] = await Promise.all([
            Class.findOne({ _id: classId, school_id: schoolId }),
            Subject.findOne({ _id: subjectId, school_id: schoolId }),
            Term.findOne({ _id: termId, school_id: schoolId }),
        ]);

        if (!classExists) throw new Error('Turma não encontrada ou não pertence à sua escola.');
        if (!subjectExists) throw new Error('Disciplina não encontrada ou não pertence à sua escola.');
        if (!termExists) throw new Error('Período (Bimestre) não encontrado ou não pertence à sua escola.');
        
        // [OPCIONAL] Se Turma, Disciplina e Período já têm school_id, 
        // a aula é implicitamente segura. Mas o check é bom.
    }

    /**
     * Valida se um professor está habilitado para lecionar uma disciplina. (Mantido)
     */
    async _validateTeacherAbility(teacherId, subjectId) {
        const teacher = await User.findById(teacherId).populate({
            path: 'staffProfiles',
            model: 'StaffProfile'
        });

        if (!teacher || !teacher.staffProfiles || teacher.staffProfiles.length === 0) {
            throw new Error('Professor não encontrado ou não possui um perfil de funcionário.');
        }

        const isEnabled = teacher.staffProfiles.some(profile => 
            profile.enabledSubjects && profile.enabledSubjects.includes(subjectId)
        );

        if (!isEnabled) {
            throw new Error(`Professor(a) ${teacher.fullName} não está habilitado(a) para lecionar esta disciplina.`);
        }
        
        return true; 
    }

    /**
     * Cria múltiplos horários (em lote).
     */
    async createMultipleHorarios(horariosData, schoolId) {
        if (!Array.isArray(horariosData) || horariosData.length === 0) {
            throw new Error('Dados de entrada inválidos.');
        }

        const horariosWithSchool = horariosData.map(aula => ({
            ...aula,
            school_id: schoolId // Injeta o ID da escola
        }));

        // 1. Valida todas as referências ANTES de inserir (a validação de professor é mais pesada)
        for (const aula of horariosWithSchool) {
             await this._validateReferences(aula, schoolId);
        }

        // 2. Inserir no Banco
        try {
            const createdHorarios = await Horario.insertMany(horariosWithSchool, { ordered: false });
            
            // 3. Popular e retornar os criados com sucesso
            const createdIds = createdHorarios.map(h => h._id);
            const populatedHorarios = await Horario.find({ _id: { $in: createdIds } })
                                                   .populate(defaultPopulation);
                                                   
            return populatedHorarios;

        } catch (error) {
            // Lida com erros de duplicata
            if (error.name === 'MongoBulkWriteError' && error.code === 11000) {
                console.warn('Aviso de BulkWrite: Alguns horários duplicados foram ignorados.');
                if (error.result && error.result.insertedIds && error.result.insertedIds.length > 0) {
                    const insertedIds = error.result.insertedIds.map(doc => doc._id);
                    const populated = await Horario.find({ _id: { $in: insertedIds } }).populate(defaultPopulation);
                    return populated;
                }
                return []; 
            }
            throw error;
        }
    }

    /**
     * Cria um novo horário (aula) para uma turma.
     */
    async createHorario(horarioData, schoolId) {
        const dataToCreate = { ...horarioData, school_id: schoolId };

        // 1. Validações cruzadas de segurança e habilidade
        await this._validateReferences(dataToCreate, schoolId);

        // 2. Salva no Banco
        try {
            const newHorario = new Horario(dataToCreate);
            await newHorario.save();
            
            await newHorario.populate(defaultPopulation);
            return newHorario;
            
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`Conflito de horário: Já existe uma aula cadastrada para esta turma, neste dia e horário.`);
            }
            throw error;
        }
    }

    /**
     * Busca horários com base em filtros, limitados pela escola.
     */
    async getHorarios(filter = {}, schoolId) {
        // Filtro obrigatório por escola
        const query = { ...filter, school_id: schoolId }; 

        return await Horario.find(query)
            .populate(defaultPopulation)
            .sort({ dayOfWeek: 1, startTime: 1 });
    }

    /**
     * Busca um horário específico por ID, limitado pela escola.
     */
    async getHorarioById(id, schoolId) {
        // Busca o horário garantindo que pertence à escola
        const horario = await Horario.findOne({ _id: id, school_id: schoolId }).populate(defaultPopulation);

        if (!horario) {
            throw new Error('Horário não encontrado ou não pertence à sua escola.');
        }
        return horario;
    }

    /**
     * Atualiza um horário.
     */
    async updateHorario(id, updateData, schoolId) {
        const existingHorario = await Horario.findOne({ _id: id, school_id: schoolId });
        if (!existingHorario) {
            throw new Error('Horário não encontrado ou não pertence à sua escola.');
        }
        
        // Se houver tentativa de mudar o teacher, subject, class ou term, validamos as novas referências
        if (updateData.teacherId || updateData.subjectId || updateData.classId || updateData.termId) {
            
            const combinedData = {
                teacherId: updateData.teacherId || existingHorario.teacherId,
                subjectId: updateData.subjectId || existingHorario.subjectId,
                classId: updateData.classId || existingHorario.classId,
                termId: updateData.termId || existingHorario.termId,
            };

            await this._validateReferences(combinedData, schoolId);
        }
        
        // Garante que o school_id não pode ser alterado via updateData
        delete updateData.school_id;

        try {
            const updatedHorario = await Horario.findOneAndUpdate(
                { _id: id, school_id: schoolId }, // Query de atualização segura
                updateData, 
                { new: true, runValidators: true }
            ).populate(defaultPopulation);
            
            return updatedHorario;

        } catch (error) {
            if (error.code === 11000) {
                throw new Error('Conflito de horário: A atualização resultou em um horário duplicado (Turma/Dia/Hora).');
            }
            throw error;
        }
    }

    /**
     * Deleta um horário.
     */
    async deleteHorario(id, schoolId) {
        const deletedHorario = await Horario.findOneAndDelete({ _id: id, school_id: schoolId }).populate(defaultPopulation);
        if (!deletedHorario) {
            throw new Error('Horário não encontrado ou não pertence à sua escola para deletar.');
        }
        return deletedHorario;
    }
}

module.exports = new HorarioService();