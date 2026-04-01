const TechnicalModuleRecord = require('../models/technicalModuleRecord.model');
const TechnicalEnrollment = require('../models/technicalEnrollment.model');
const TechnicalProgramModule = require('../models/technicalProgramModule.model');
const TechnicalProgramOffering = require('../models/technicalProgramOffering.model');
const TechnicalProgramOfferingModule = require('../models/technicalProgramOfferingModule.model');

const defaultPopulation = [
    {
        path: 'technicalEnrollmentId',
        select: 'studentId companyId technicalProgramId currentTechnicalProgramOfferingId currentClassId enrollmentDate status',
        populate: [
            { path: 'studentId', select: 'fullName birthDate cpf' },
            { path: 'companyId', select: 'name legalName cnpj' },
            { path: 'technicalProgramId', select: 'name totalWorkloadHours' },
            {
                path: 'currentTechnicalProgramOfferingId',
                select: 'technicalProgramId name code status plannedStartDate plannedEndDate actualStartDate actualEndDate shift capacity defaultSpaceId',
                populate: [
                    { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
                    { path: 'defaultSpaceId', select: 'name type capacity status' },
                    {
                        path: 'modules',
                        options: { sort: { executionOrder: 1 } },
                        populate: [
                            { path: 'technicalProgramModuleId', select: 'name moduleOrder workloadHours subjectId status', populate: { path: 'subjectId', select: 'name level' } },
                            { path: 'prerequisiteModuleIds', select: 'name moduleOrder workloadHours status' },
                            { path: 'scheduleSlots.teacherIds', select: 'fullName email roles status' },
                            { path: 'scheduleSlots.publishedByUserId', select: 'fullName email roles status' },
                            { path: 'scheduleSlots.publicationRevertedByUserId', select: 'fullName email roles status' },
                            { path: 'scheduleSlots.spaceId', select: 'name type capacity status' }
                        ]
                    }
                ]
            },
            { path: 'currentClassId', select: 'name schoolYear grade shift' }
        ]
    },
    {
        path: 'technicalProgramModuleId',
        select: 'technicalProgramId subjectId name moduleOrder workloadHours status prerequisiteModuleIds',
        populate: [
            { path: 'subjectId', select: 'name level' },
            { path: 'prerequisiteModuleIds', select: 'name moduleOrder workloadHours status' }
        ]
    },
    {
        path: 'technicalProgramOfferingId',
        select: 'technicalProgramId name code status plannedStartDate plannedEndDate actualStartDate actualEndDate shift capacity defaultSpaceId',
        populate: [
            { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
            { path: 'defaultSpaceId', select: 'name type capacity status' },
            {
                path: 'modules',
                options: { sort: { executionOrder: 1 } },
                populate: [
                    { path: 'technicalProgramModuleId', select: 'name moduleOrder workloadHours subjectId status', populate: { path: 'subjectId', select: 'name level' } },
                    { path: 'prerequisiteModuleIds', select: 'name moduleOrder workloadHours status' },
                    { path: 'scheduleSlots.teacherIds', select: 'fullName email roles status' },
                    { path: 'scheduleSlots.spaceId', select: 'name type capacity status' }
                ]
            }
        ]
    },
    {
        path: 'technicalProgramOfferingModuleId',
        select: 'technicalProgramOfferingId technicalProgramModuleId executionOrder moduleOrderSnapshot plannedWorkloadHours plannedWeeklyMinutes estimatedWeeks estimatedStartDate estimatedEndDate status scheduleSlots',
        populate: [
            {
                path: 'technicalProgramOfferingId',
                select: 'technicalProgramId name code status plannedStartDate plannedEndDate actualStartDate actualEndDate shift capacity defaultSpaceId',
                populate: [
                    { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
                    { path: 'defaultSpaceId', select: 'name type capacity status' }
                ]
            },
            { path: 'technicalProgramModuleId', select: 'technicalProgramId subjectId name moduleOrder workloadHours status', populate: { path: 'subjectId', select: 'name level' } },
            { path: 'scheduleSlots.teacherIds', select: 'fullName email roles status' },
            { path: 'scheduleSlots.publishedByUserId', select: 'fullName email roles status' },
            { path: 'scheduleSlots.publicationRevertedByUserId', select: 'fullName email roles status' },
            { path: 'scheduleSlots.spaceId', select: 'name type capacity status' }
        ]
    }
];

const hasValue = (value) => value !== undefined && value !== null && value !== '';

class TechnicalModuleRecordService {
    async createTechnicalModuleRecord(recordData, schoolId) {
        const {
            technicalEnrollmentId,
            technicalProgramModuleId,
            technicalProgramOfferingId,
            technicalProgramOfferingModuleId
        } = recordData;

        const enrollment = await TechnicalEnrollment.findOne({
            _id: technicalEnrollmentId,
            school_id: schoolId
        });

        if (!enrollment) {
            throw new Error('Matricula tecnica nao encontrada ou nao pertence a esta escola.');
        }

        const module = await TechnicalProgramModule.findOne({
            _id: technicalProgramModuleId,
            school_id: schoolId
        });

        if (!module) {
            throw new Error('Modulo tecnico nao encontrado ou nao pertence a esta escola.');
        }

        if (String(enrollment.technicalProgramId) !== String(module.technicalProgramId)) {
            throw new Error('O modulo tecnico nao pertence ao mesmo programa da matricula.');
        }

        let resolvedOfferingId = hasValue(technicalProgramOfferingId)
            ? technicalProgramOfferingId
            : (hasValue(enrollment.currentTechnicalProgramOfferingId) ? enrollment.currentTechnicalProgramOfferingId : null);
        let resolvedOfferingModuleId = hasValue(technicalProgramOfferingModuleId) ? technicalProgramOfferingModuleId : null;

        if (hasValue(resolvedOfferingModuleId)) {
            const offeringModule = await TechnicalProgramOfferingModule.findOne({
                _id: resolvedOfferingModuleId,
                school_id: schoolId
            });

            if (!offeringModule) {
                throw new Error('Execucao do modulo da oferta nao encontrada ou nao pertence a esta escola.');
            }

            if (String(offeringModule.technicalProgramModuleId) !== String(technicalProgramModuleId)) {
                throw new Error('A execucao do modulo da oferta nao corresponde ao modulo informado no historico.');
            }

            resolvedOfferingModuleId = offeringModule._id;
            resolvedOfferingId = offeringModule.technicalProgramOfferingId;
        }

        if (hasValue(resolvedOfferingId)) {
            const offering = await TechnicalProgramOffering.findOne({
                _id: resolvedOfferingId,
                school_id: schoolId
            });

            if (!offering) {
                throw new Error('Oferta tecnica nao encontrada ou nao pertence a esta escola.');
            }

            if (String(offering.technicalProgramId) !== String(enrollment.technicalProgramId)) {
                throw new Error('A oferta tecnica nao pertence ao mesmo programa da matricula.');
            }

            if (!hasValue(resolvedOfferingModuleId)) {
                const matchingOfferingModule = await TechnicalProgramOfferingModule.findOne({
                    technicalProgramOfferingId: resolvedOfferingId,
                    technicalProgramModuleId,
                    school_id: schoolId
                });

                if (!matchingOfferingModule) {
                    throw new Error('A oferta tecnica informada nao possui execucao deste modulo.');
                }

                resolvedOfferingModuleId = matchingOfferingModule._id;
            }

            if (hasValue(enrollment.currentTechnicalProgramOfferingId) && String(enrollment.currentTechnicalProgramOfferingId) !== String(resolvedOfferingId)) {
                throw new Error('A oferta do historico nao corresponde a oferta atual da matricula tecnica.');
            }
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
            throw new Error('A carga horaria concluida nao pode ser negativa.');
        }

        if (completedHours > workloadHours) {
            throw new Error('A carga horaria concluida nao pode ser maior que a carga horaria do modulo.');
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
            throw new Error('Um modulo concluido precisa ter a carga horaria completa registrada.');
        }

        try {
            const newRecord = new TechnicalModuleRecord({
                technicalEnrollmentId,
                technicalProgramModuleId,
                technicalProgramOfferingId: resolvedOfferingId,
                technicalProgramOfferingModuleId: resolvedOfferingModuleId,
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
                throw new Error('Ja existe um historico para esta tentativa do modulo.');
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
            throw new Error('Historico do modulo nao encontrado ou nao pertence a esta escola.');
        }

        return record;
    }

    async updateTechnicalModuleRecord(id, updateData, schoolId) {
        delete updateData.school_id;
        delete updateData.technicalEnrollmentId;
        delete updateData.technicalProgramModuleId;
        delete updateData.technicalProgramOfferingId;
        delete updateData.technicalProgramOfferingModuleId;
        delete updateData.attemptNumber;
        delete updateData.moduleWorkloadHours;

        const currentRecord = await TechnicalModuleRecord.findOne({
            _id: id,
            school_id: schoolId
        });

        if (!currentRecord) {
            throw new Error('Historico do modulo nao encontrado para atualizar.');
        }

        const nextStatus = updateData.status || currentRecord.status;
        const nextCompletedHours = updateData.completedHours !== undefined
            ? updateData.completedHours
            : currentRecord.completedHours;
        const workloadHours = currentRecord.moduleWorkloadHours;

        if (nextCompletedHours < 0) {
            throw new Error('A carga horaria concluida nao pode ser negativa.');
        }

        if (nextCompletedHours > workloadHours) {
            throw new Error('A carga horaria concluida nao pode ser maior que a carga horaria do modulo.');
        }

        if (nextStatus === 'Concluído' && nextCompletedHours < workloadHours) {
            throw new Error('Um modulo concluido precisa ter a carga horaria completa registrada.');
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
            throw new Error('Historico do modulo nao encontrado para atualizar.');
        }

        return updatedRecord;
    }
}

module.exports = new TechnicalModuleRecordService();
