const TechnicalProgram = require('../models/technicalProgram.model');

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
