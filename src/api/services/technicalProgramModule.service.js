const TechnicalProgramModule = require('../models/technicalProgramModule.model');
const TechnicalProgram = require('../models/technicalProgram.model');
const Subject = require('../models/subject.model');

class TechnicalProgramModuleService {
    async createTechnicalProgramModule(moduleData, schoolId) {
        const technicalProgramId = moduleData.technicalProgramId;

        if (!technicalProgramId) {
            throw new Error('O programa técnico é obrigatório.');
        }

        const technicalProgram = await TechnicalProgram.findOne({
            _id: technicalProgramId,
            school_id: schoolId
        });

        if (!technicalProgram) {
            throw new Error('Programa técnico não encontrado ou não pertence a esta escola.');
        }

        if (moduleData.subjectId) {
            const subject = await Subject.findOne({
                _id: moduleData.subjectId,
                school_id: schoolId
            });

            if (!subject) {
                throw new Error('Disciplina não encontrada ou não pertence a esta escola.');
            }
        }

        const existing = await TechnicalProgramModule.findOne({
            technicalProgramId,
            moduleOrder: moduleData.moduleOrder,
            school_id: schoolId
        });

        if (existing) {
            throw new Error(`Já existe um módulo na ordem ${moduleData.moduleOrder} para este programa.`);
        }

        try {
            const newModule = new TechnicalProgramModule({
                ...moduleData,
                school_id: schoolId
            });

            await newModule.save();
            return newModule;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`Já existe um módulo na ordem ${moduleData.moduleOrder} para este programa.`);
            }
            throw error;
        }
    }

    async getAllTechnicalProgramModules(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await TechnicalProgramModule.find({
            ...query,
            school_id: schoolId
        }).sort({ technicalProgramId: 1, moduleOrder: 1 });
    }

    async getTechnicalProgramModuleById(id, schoolId) {
        const module = await TechnicalProgramModule.findOne({ _id: id, school_id: schoolId });

        if (!module) {
            throw new Error('Módulo técnico não encontrado ou não pertence a esta escola.');
        }

        return module;
    }

    async updateTechnicalProgramModule(id, updateData, schoolId) {
        delete updateData.school_id;

        const currentModule = await TechnicalProgramModule.findOne({
            _id: id,
            school_id: schoolId
        });

        if (!currentModule) {
            throw new Error('Módulo técnico não encontrado para atualizar.');
        }

        const nextTechnicalProgramId = updateData.technicalProgramId || currentModule.technicalProgramId;
        const nextModuleOrder = updateData.moduleOrder ?? currentModule.moduleOrder;

        if (updateData.technicalProgramId) {
            const technicalProgram = await TechnicalProgram.findOne({
                _id: updateData.technicalProgramId,
                school_id: schoolId
            });

            if (!technicalProgram) {
                throw new Error('Programa técnico não encontrado ou não pertence a esta escola.');
            }
        }

        if (updateData.subjectId) {
            const subject = await Subject.findOne({
                _id: updateData.subjectId,
                school_id: schoolId
            });

            if (!subject) {
                throw new Error('Disciplina não encontrada ou não pertence a esta escola.');
            }
        }

        const existing = await TechnicalProgramModule.findOne({
            _id: { $ne: id },
            technicalProgramId: nextTechnicalProgramId,
            moduleOrder: nextModuleOrder,
            school_id: schoolId
        });

        if (existing) {
            throw new Error(`Já existe um módulo na ordem ${nextModuleOrder} para este programa.`);
        }

        const updatedModule = await TechnicalProgramModule.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedModule) {
            throw new Error('Módulo técnico não encontrado para atualizar.');
        }

        return updatedModule;
    }

    async inactivateTechnicalProgramModule(id, schoolId) {
        const module = await TechnicalProgramModule.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { status: 'Inativo' },
            { new: true, runValidators: true }
        );

        if (!module) {
            throw new Error('Módulo técnico não encontrado para inativar.');
        }

        return module;
    }
}

module.exports = new TechnicalProgramModuleService();
