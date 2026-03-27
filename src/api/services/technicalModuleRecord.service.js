const TechnicalModuleRecord = require('../models/technicalModuleRecord.model');
const TechnicalEnrollment = require('../models/technicalEnrollment.model');
const TechnicalProgramModule = require('../models/technicalProgramModule.model');

const defaultPopulation = [
    {
        path: 'technicalEnrollmentId',
        select: 'studentId companyId technicalProgramId currentClassId enrollmentDate status',
        populate: [
            { path: 'studentId', select: 'fullName birthDate cpf' },
            { path: 'companyId', select: 'name legalName cnpj' },
            { path: 'technicalProgramId', select: 'name totalWorkloadHours' },
            { path: 'currentClassId', select: 'name schoolYear grade shift' }
        ]
    },
    {
        path: 'technicalProgramModuleId',
        select: 'name moduleOrder workloadHours subjectId status',
        populate: [
            { path: 'subjectId', select: 'name level' }
        ]
    }
];

class TechnicalModuleRecordService {
    async createTechnicalModuleRecord(recordData, schoolId) {
        const {
            technicalEnrollmentId,
            technicalProgramModuleId
        } = recordData;

        const enrollment = await TechnicalEnrollment.findOne({
            _id: technicalEnrollmentId,
            school_id: schoolId
        });

        if (!enrollment) {
            throw new Error('Matrícula técnica não encontrada ou não pertence a esta escola.');
        }

        const module = await TechnicalProgramModule.findOne({
            _id: technicalProgramModuleId,
            school_id: schoolId
        });

        if (!module) {
            throw new Error('Módulo técnico não encontrado ou não pertence a esta escola.');
        }

        if (String(enrollment.technicalProgramId) !== String(module.technicalProgramId)) {
            throw new Error('O módulo técnico não pertence ao mesmo programa da matrícula.');
        }

        const lastRecord = await TechnicalModuleRecord.findOne({
            technicalEnrollmentId,
            technicalProgramModuleId,
            school_id: schoolId
        }).sort({ attemptNumber: -1 });

        const attemptNumber = lastRecord ? lastRecord.attemptNumber + 1 : 1;
        const status = recordData.status || 'Pendente';
        const workloadHours = module.workloadHours;

        const completedHours = recordData.completedHours !== undefined && recordData.completedHours !== null
            ? recordData.completedHours
            : (status === 'Concluído' ? workloadHours : 0);

        if (completedHours < 0) {
            throw new Error('A carga horária concluída não pode ser negativa.');
        }

        if (completedHours > workloadHours) {
            throw new Error('A carga horária concluída não pode ser maior que a carga horária do módulo.');
        }

        const now = new Date();
        let startedAt = recordData.startedAt || null;
        let finishedAt = recordData.finishedAt || null;

        if (!startedAt && ['Em andamento', 'Concluído', 'Reprovado', 'Repetindo'].includes(status)) {
            startedAt = now;
        }

        if (!finishedAt && ['Concluído', 'Reprovado'].includes(status)) {
            finishedAt = now;
        }

        if (status === 'Concluído' && completedHours < workloadHours) {
            throw new Error('Um módulo concluído precisa ter a carga horária completa registrada.');
        }

        try {
            const newRecord = new TechnicalModuleRecord({
                technicalEnrollmentId,
                technicalProgramModuleId,
                attemptNumber,
                moduleWorkloadHours: workloadHours,
                completedHours,
                status,
                startedAt,
                finishedAt,
                notes: recordData.notes,
                school_id: schoolId
            });

            await newRecord.save();
            await newRecord.populate(defaultPopulation);

            return newRecord;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error('Já existe um histórico para esta tentativa do módulo.');
            }
            throw error;
        }
    }

    async getAllTechnicalModuleRecords(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await TechnicalModuleRecord.find({
            ...query,
            school_id: schoolId
        })
            .populate(defaultPopulation)
            .sort({ technicalEnrollmentId: 1, technicalProgramModuleId: 1, attemptNumber: 1 });
    }

    async getTechnicalModuleRecordById(id, schoolId) {
        const record = await TechnicalModuleRecord.findOne({
            _id: id,
            school_id: schoolId
        }).populate(defaultPopulation);

        if (!record) {
            throw new Error('Histórico do módulo não encontrado ou não pertence a esta escola.');
        }

        return record;
    }

    async updateTechnicalModuleRecord(id, updateData, schoolId) {
        delete updateData.school_id;
        delete updateData.technicalEnrollmentId;
        delete updateData.technicalProgramModuleId;
        delete updateData.attemptNumber;
        delete updateData.moduleWorkloadHours;

        const currentRecord = await TechnicalModuleRecord.findOne({
            _id: id,
            school_id: schoolId
        });

        if (!currentRecord) {
            throw new Error('Histórico do módulo não encontrado para atualizar.');
        }

        const nextStatus = updateData.status || currentRecord.status;
        const nextCompletedHours = updateData.completedHours !== undefined
            ? updateData.completedHours
            : currentRecord.completedHours;
        const workloadHours = currentRecord.moduleWorkloadHours;

        if (nextCompletedHours < 0) {
            throw new Error('A carga horária concluída não pode ser negativa.');
        }

        if (nextCompletedHours > workloadHours) {
            throw new Error('A carga horária concluída não pode ser maior que a carga horária do módulo.');
        }

        if (nextStatus === 'Concluído' && nextCompletedHours < workloadHours) {
            throw new Error('Um módulo concluído precisa ter a carga horária completa registrada.');
        }

        if (!updateData.startedAt && ['Em andamento', 'Concluído', 'Reprovado', 'Repetindo'].includes(nextStatus) && !currentRecord.startedAt) {
            updateData.startedAt = new Date();
        }

        if (!updateData.finishedAt && ['Concluído', 'Reprovado'].includes(nextStatus) && !currentRecord.finishedAt) {
            updateData.finishedAt = new Date();
        }

        const updatedRecord = await TechnicalModuleRecord.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate(defaultPopulation);

        if (!updatedRecord) {
            throw new Error('Histórico do módulo não encontrado para atualizar.');
        }

        return updatedRecord;
    }
}

module.exports = new TechnicalModuleRecordService();
