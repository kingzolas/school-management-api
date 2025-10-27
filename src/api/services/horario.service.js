const Horario = require('../models/horario.model');
const User = require('../models/user.model');
const StaffProfile = require('../models/staffProfile.model');
const Subject = require('../models/subject.model');
const Class = require('../models/class.model');
const mongoose = require('mongoose');

// População padrão para retornar dados úteis ao frontend
const defaultPopulation = [
    { 
        path: 'teacherId', // Nome do campo no horario.model
        select: 'fullName email' // O que queremos do model 'User'
    },
    { 
        path: 'subjectId', // Nome do campo no horario.model
        select: 'name level' // O que queremos do model 'Subject'
    },
    {
        path: 'classId', // Nome do campo no horario.model
        select: 'name grade schoolYear' // O que queremos do model 'Class'
    }
];

class HorarioService {

    /**
     * Valida se um professor está habilitado para lecionar uma disciplina.
     * @param {string} teacherId - O ID do User (professor)
     * @param {string} subjectId - O ID da Subject (disciplina)
     */
    async _validateTeacherAbility(teacherId, subjectId) {
        // 1. Busca o professor e seus perfis
        const teacher = await User.findById(teacherId).populate({
             path: 'staffProfiles',
             model: 'StaffProfile'
             // Não precisamos popular 'enabledSubjects' dentro do perfil, pois é um array de IDs
        });

        if (!teacher || !teacher.staffProfiles || teacher.staffProfiles.length === 0) {
            throw new Error('Professor não encontrado ou não possui um perfil de funcionário.');
        }

        // 2. Procura a disciplina em TODOS os perfis do professor
        // (Resolve o "Cenário da Maria" que é Coordenadora E Professora)
        const isEnabled = teacher.staffProfiles.some(profile => 
            profile.enabledSubjects && profile.enabledSubjects.includes(subjectId)
        );

        if (!isEnabled) {
            throw new Error(`Professor(a) ${teacher.fullName} não está habilitado(a) para esta disciplina.`);
        }
        
        return true; // Validação OK
    }

    /**
     * Cria um novo horário (aula) para uma turma.
     */
    async createHorario(horarioData) {
        const { teacherId, subjectId, classId, dayOfWeek, startTime } = horarioData;

        // 1. Valida Habilitação do Professor
        await this._validateTeacherAbility(teacherId, subjectId);

        // 2. Valida se a Turma existe (opcional, mas bom)
        const classExists = await Class.findById(classId);
        if (!classExists) throw new Error('Turma não encontrada.');

        // 3. Valida se a Disciplina existe (opcional, mas bom)
        const subjectExists = await Subject.findById(subjectId);
        if (!subjectExists) throw new Error('Disciplina não encontrada.');

        // 4. Salva no Banco
        // A validação de conflito de horário (mesma turma, dia, hora)
        // será tratada pelo índice único no 'horario.model.js'
        try {
            const newHorario = new Horario(horarioData);
            await newHorario.save();
            
            // Popula o documento antes de retornar
            await newHorario.populate(defaultPopulation);
            return newHorario;
            
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`Conflito de horário: Já existe uma aula cadastrada para esta turma, neste dia e horário (${dayOfWeek}, ${startTime}).`);
            }
            throw error;
        }
    }

    /**
     * Busca horários com base em filtros (ex: por turma ou por professor).
     */
    async getHorarios(filter = {}) {
        // Filtros podem ser passados via query string: ?classId=... ou ?teacherId=...
        return await Horario.find(filter)
            .populate(defaultPopulation)
            .sort({ dayOfWeek: 1, startTime: 1 }); // Ordena por dia da semana e hora
    }

    /**
     * Busca um horário específico por ID.
     */
    async getHorarioById(id) {
        const horario = await Horario.findById(id).populate(defaultPopulation);
        if (!horario) {
            throw new Error('Horário não encontrado.');
        }
        return horario;
    }

    /**
     * Atualiza um horário.
     */
    async updateHorario(id, updateData) {
        const existingHorario = await Horario.findById(id);
        if (!existingHorario) {
            throw new Error('Horário não encontrado para atualizar.');
        }

        // Se o professor ou a disciplina mudou, re-validar!
        const teacherId = updateData.teacherId || existingHorario.teacherId;
        const subjectId = updateData.subjectId || existingHorario.subjectId;
        
        if (updateData.teacherId || updateData.subjectId) {
             await this._validateTeacherAbility(teacherId, subjectId);
        }

        try {
            const updatedHorario = await Horario.findByIdAndUpdate(id, updateData, {
                new: true,
                runValidators: true
            }).populate(defaultPopulation);
            
            return updatedHorario;
        } catch (error) {
             if (error.code === 11000) {
                throw new Error('Conflito de horário: A atualização resultou em um horário duplicado.');
            }
            throw error;
        }
    }

    /**
     * Deleta um horário.
     */
    async deleteHorario(id) {
        const deletedHorario = await Horario.findByIdAndDelete(id).populate(defaultPopulation);
        if (!deletedHorario) {
            throw new Error('Horário não encontrado para deletar.');
        }
        // Retorna o documento que foi deletado (já populado)
        return deletedHorario;
    }
}

module.exports = new HorarioService();