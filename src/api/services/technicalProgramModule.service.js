const TechnicalProgramModule = require('../models/technicalProgramModule.model');
const TechnicalProgram = require('../models/technicalProgram.model');
const Subject = require('../models/subject.model');
const TechnicalProgramOfferingModule = require('../models/technicalProgramOfferingModule.model');
const TechnicalModuleRecord = require('../models/technicalModuleRecord.model');
const { getProgramModuleWorkloadSummary } = require('./technicalCurriculum.helper');

const hasValue = (value) => value !== undefined && value !== null && value !== '';

class TechnicalProgramModuleService {
    async _assertModuleIsNotInUse(moduleId, schoolId) {
        const [hasOfferingModules, hasRecords] = await Promise.all([
            TechnicalProgramOfferingModule.exists({
                technicalProgramModuleId: moduleId,
                school_id: schoolId
            }),
            TechnicalModuleRecord.exists({
                technicalProgramModuleId: moduleId,
                school_id: schoolId
            })
        ]);

        return Boolean(hasOfferingModules || hasRecords);
    }

    async _assertProgramWorkloadCapacity(technicalProgramId, schoolId, nextModuleWorkloadHours, excludeModuleId = null) {
        const technicalProgram = await TechnicalProgram.findOne({
            _id: technicalProgramId,
            school_id: schoolId
        });

        if (!technicalProgram) {
            throw new Error('Programa técnico não encontrado ou não pertence a esta escola.');
        }

        const workloadSummary = await getProgramModuleWorkloadSummary(technicalProgramId, schoolId, excludeModuleId);
        const nextTotalWorkloadHours = workloadSummary.totalWorkloadHours + Number(nextModuleWorkloadHours || 0);

        if (nextTotalWorkloadHours > Number(technicalProgram.totalWorkloadHours || 0)) {
            throw new Error('A soma das cargas horárias dos módulos não pode ser maior que a carga horária total do programa.');
        }

        return technicalProgram;
    }

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

        const nextModuleWorkloadHours = Number(moduleData.workloadHours);
        if (!Number.isFinite(nextModuleWorkloadHours) || nextModuleWorkloadHours < 0) {
            throw new Error('A carga horária do módulo precisa ser um número válido.');
        }

        await this._assertProgramWorkloadCapacity(technicalProgramId, schoolId, nextModuleWorkloadHours);

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

        const lockedModule = await this._assertModuleIsNotInUse(id, schoolId);

        if (updateData.technicalProgramId && String(updateData.technicalProgramId) !== String(currentModule.technicalProgramId) && lockedModule) {
            throw new Error('Não é permitido mover um módulo já utilizado para outro programa técnico.');
        }

        if (
            (Object.prototype.hasOwnProperty.call(updateData, 'moduleOrder') ||
            Object.prototype.hasOwnProperty.call(updateData, 'workloadHours') ||
            Object.prototype.hasOwnProperty.call(updateData, 'technicalProgramId')) &&
            lockedModule
        ) {
            throw new Error('Não é permitido alterar ordem, carga horária ou programa de um módulo já utilizado na oferta ou no histórico.');
        }

        const nextWorkloadHours = Object.prototype.hasOwnProperty.call(updateData, 'workloadHours')
            ? Number(updateData.workloadHours)
            : Number(currentModule.workloadHours);

        if (Object.prototype.hasOwnProperty.call(updateData, 'workloadHours')) {
            if (!Number.isFinite(nextWorkloadHours) || nextWorkloadHours < 0) {
                throw new Error('A carga horária do módulo precisa ser um número válido.');
            }
        }

        const nextTechnicalProgramId = updateData.technicalProgramId || currentModule.technicalProgramId;
        await this._assertProgramWorkloadCapacity(nextTechnicalProgramId, schoolId, nextWorkloadHours, id);
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
