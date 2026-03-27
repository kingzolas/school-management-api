const TechnicalProgram = require('../models/technicalProgram.model');
const { getProgramModuleWorkloadSummary } = require('./technicalCurriculum.helper');

class TechnicalProgramService {
    async createTechnicalProgram(programData, schoolId) {
        try {
            const newProgram = new TechnicalProgram({
                ...programData,
                school_id: schoolId
            });

            await newProgram.save();
            return newProgram;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`O programa técnico '${programData.name}' já existe nesta escola.`);
            }
            throw error;
        }
    }

    async getAllTechnicalPrograms(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await TechnicalProgram.find({
            ...query,
            school_id: schoolId
        }).sort({ name: 1 });
    }

    async getTechnicalProgramById(id, schoolId) {
        const program = await TechnicalProgram.findOne({ _id: id, school_id: schoolId });

        if (!program) {
            throw new Error('Programa técnico não encontrado ou não pertence a esta escola.');
        }

        return program;
    }

    async updateTechnicalProgram(id, updateData, schoolId) {
        delete updateData.school_id;

        if (updateData.name) {
            const existing = await TechnicalProgram.findOne({
                _id: { $ne: id },
                name: updateData.name,
                school_id: schoolId
            });

            if (existing) {
                throw new Error(`O programa técnico '${updateData.name}' já existe nesta escola.`);
            }
        }

        if (Object.prototype.hasOwnProperty.call(updateData, 'totalWorkloadHours')) {
            const nextTotalWorkloadHours = Number(updateData.totalWorkloadHours);
            if (!Number.isFinite(nextTotalWorkloadHours) || nextTotalWorkloadHours < 0) {
                throw new Error('A carga horária total do programa precisa ser um número válido.');
            }

            const workloadSummary = await getProgramModuleWorkloadSummary(id, schoolId);
            if (workloadSummary.totalWorkloadHours > nextTotalWorkloadHours) {
                throw new Error('A carga horária total do programa não pode ser menor que a soma das cargas horárias dos módulos já cadastrados.');
            }

            updateData.totalWorkloadHours = nextTotalWorkloadHours;
        }

        const updatedProgram = await TechnicalProgram.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedProgram) {
            throw new Error('Programa técnico não encontrado para atualizar.');
        }

        return updatedProgram;
    }

    async inactivateTechnicalProgram(id, schoolId) {
        const program = await TechnicalProgram.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { status: 'Inativo' },
            { new: true, runValidators: true }
        );

        if (!program) {
            throw new Error('Programa técnico não encontrado para inativar.');
        }

        return program;
    }
}

module.exports = new TechnicalProgramService();
