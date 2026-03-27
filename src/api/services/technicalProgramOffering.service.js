const TechnicalProgramOffering = require('../models/technicalProgramOffering.model');
const TechnicalProgram = require('../models/technicalProgram.model');
const TechnicalSpace = require('../models/technicalSpace.model');
const TechnicalProgramOfferingModule = require('../models/technicalProgramOfferingModule.model');
const TechnicalEnrollment = require('../models/technicalEnrollment.model');
const TechnicalModuleRecord = require('../models/technicalModuleRecord.model');
const { hasValue, parseDate, computeModuleDerivedValues } = require('./technicalOfferingMath.helper');

const validateDateRange = (startDate, endDate, messagePrefix) => {
    if (startDate && endDate && endDate < startDate) {
        throw new Error(`${messagePrefix} a data de termino nao pode ser anterior a data de inicio.`);
    }
};

const getOfferingModulePopulation = () => ([
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
]);

class TechnicalProgramOfferingService {
    async _hasLinkedChildren(offeringId, schoolId) {
        const [hasModules, hasEnrollments, hasRecords] = await Promise.all([
            TechnicalProgramOfferingModule.exists({
                technicalProgramOfferingId: offeringId,
                school_id: schoolId
            }),
            TechnicalEnrollment.exists({
                currentTechnicalProgramOfferingId: offeringId,
                school_id: schoolId
            }),
            TechnicalModuleRecord.exists({
                technicalProgramOfferingId: offeringId,
                school_id: schoolId
            })
        ]);

        return Boolean(hasModules || hasEnrollments || hasRecords);
    }

    async _recalculateChildModules(offering) {
        const modules = await TechnicalProgramOfferingModule.find({
            technicalProgramOfferingId: offering._id,
            school_id: offering.school_id
        });

        for (const module of modules) {
            const baseEstimatedStartDate = module.estimatedStartDateSource === 'Manual'
                ? module.estimatedStartDate
                : (offering.actualStartDate || offering.plannedStartDate);

            const derivedValues = computeModuleDerivedValues(
                module.plannedWorkloadHours,
                Array.isArray(module.scheduleSlots) ? module.scheduleSlots : [],
                baseEstimatedStartDate
            );

            module.estimatedStartDate = derivedValues.estimatedStartDate;
            module.estimatedEndDate = derivedValues.estimatedEndDate;
            module.estimatedWeeks = derivedValues.estimatedWeeks;
            module.plannedWeeklyMinutes = derivedValues.plannedWeeklyMinutes;
            await module.save();
        }
    }

    async createTechnicalProgramOffering(offeringData, schoolId) {
        const {
            technicalProgramId,
            defaultSpaceId,
            plannedStartDate,
            plannedEndDate,
            actualStartDate,
            actualEndDate
        } = offeringData;

        const technicalProgram = await TechnicalProgram.findOne({
            _id: technicalProgramId,
            school_id: schoolId
        });

        if (!technicalProgram) {
            throw new Error(`Programa tecnico ${technicalProgramId} nao encontrado ou nao pertence a esta escola.`);
        }

        if (!hasValue(plannedStartDate) || !hasValue(plannedEndDate)) {
            throw new Error('As datas previstas de inicio e termino da oferta sao obrigatorias.');
        }

        const normalizedPlannedStartDate = parseDate(plannedStartDate);
        const normalizedPlannedEndDate = parseDate(plannedEndDate);

        if (!normalizedPlannedStartDate || !normalizedPlannedEndDate) {
            throw new Error('As datas previstas da oferta sao invalidas.');
        }

        validateDateRange(normalizedPlannedStartDate, normalizedPlannedEndDate, 'Na oferta tecnica,');

        let normalizedDefaultSpaceId = null;
        if (hasValue(defaultSpaceId)) {
            const defaultSpace = await TechnicalSpace.findOne({
                _id: defaultSpaceId,
                school_id: schoolId
            });

            if (!defaultSpace) {
                throw new Error(`Espaco tecnico ${defaultSpaceId} nao encontrado ou nao pertence a esta escola.`);
            }

            normalizedDefaultSpaceId = defaultSpaceId;
        }

        const normalizedActualStartDate = parseDate(actualStartDate);
        const normalizedActualEndDate = parseDate(actualEndDate);
        if ((actualStartDate && !normalizedActualStartDate) || (actualEndDate && !normalizedActualEndDate)) {
            throw new Error('As datas reais da oferta sao invalidas.');
        }
        validateDateRange(normalizedActualStartDate, normalizedActualEndDate, 'Na oferta tecnica,');

        try {
            const newOffering = new TechnicalProgramOffering({
                ...offeringData,
                technicalProgramId,
                defaultSpaceId: normalizedDefaultSpaceId,
                plannedStartDate: normalizedPlannedStartDate,
                plannedEndDate: normalizedPlannedEndDate,
                actualStartDate: normalizedActualStartDate,
                actualEndDate: normalizedActualEndDate,
                status: offeringData.status || 'Planejada',
                school_id: schoolId
            });

            await newOffering.save();
            await newOffering.populate(getOfferingModulePopulation());

            return newOffering;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error('Ja existe uma oferta tecnica com estes dados nesta escola.');
            }
            throw error;
        }
    }

    async getAllTechnicalProgramOfferings(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await TechnicalProgramOffering.find({
            ...query,
            school_id: schoolId
        })
            .populate([
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
            ])
            .sort({ plannedStartDate: -1, createdAt: -1 });
    }

    async getTechnicalProgramOfferingById(id, schoolId) {
        const offering = await TechnicalProgramOffering.findOne({
            _id: id,
            school_id: schoolId
        }).populate([
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
        ]);

        if (!offering) {
            throw new Error('Oferta tecnica nao encontrada ou nao pertence a esta escola.');
        }

        return offering;
    }

    async updateTechnicalProgramOffering(id, updateData, schoolId) {
        delete updateData.school_id;

        const currentOffering = await TechnicalProgramOffering.findOne({
            _id: id,
            school_id: schoolId
        });

        if (!currentOffering) {
            throw new Error('Oferta tecnica nao encontrada para atualizar.');
        }

        const nextTechnicalProgramId = updateData.technicalProgramId || currentOffering.technicalProgramId;

        if (updateData.technicalProgramId) {
            const technicalProgram = await TechnicalProgram.findOne({
                _id: updateData.technicalProgramId,
                school_id: schoolId
            });

            if (!technicalProgram) {
                throw new Error(`Programa tecnico ${updateData.technicalProgramId} nao encontrado ou nao pertence a esta escola.`);
            }

            if (String(updateData.technicalProgramId) !== String(currentOffering.technicalProgramId)) {
                const hasChildren = await this._hasLinkedChildren(id, schoolId);
                if (hasChildren) {
                    throw new Error('Não é permitido alterar o programa de uma oferta que já possui módulos, matrículas ou histórico vinculados.');
                }
            }
        }

        if (Object.prototype.hasOwnProperty.call(updateData, 'defaultSpaceId')) {
            if (hasValue(updateData.defaultSpaceId)) {
                const defaultSpace = await TechnicalSpace.findOne({
                    _id: updateData.defaultSpaceId,
                    school_id: schoolId
                });

                if (!defaultSpace) {
                    throw new Error(`Espaco tecnico ${updateData.defaultSpaceId} nao encontrado ou nao pertence a esta escola.`);
                }
            }
        }

        const datesChanged = [
            'plannedStartDate',
            'plannedEndDate',
            'actualStartDate',
            'actualEndDate'
        ].some((field) => Object.prototype.hasOwnProperty.call(updateData, field));

        const nextPlannedStartDate = Object.prototype.hasOwnProperty.call(updateData, 'plannedStartDate')
            ? parseDate(updateData.plannedStartDate)
            : currentOffering.plannedStartDate;
        const nextPlannedEndDate = Object.prototype.hasOwnProperty.call(updateData, 'plannedEndDate')
            ? parseDate(updateData.plannedEndDate)
            : currentOffering.plannedEndDate;
        const nextActualStartDate = Object.prototype.hasOwnProperty.call(updateData, 'actualStartDate')
            ? parseDate(updateData.actualStartDate)
            : currentOffering.actualStartDate;
        const nextActualEndDate = Object.prototype.hasOwnProperty.call(updateData, 'actualEndDate')
            ? parseDate(updateData.actualEndDate)
            : currentOffering.actualEndDate;

        if (Object.prototype.hasOwnProperty.call(updateData, 'plannedStartDate') && !nextPlannedStartDate) {
            throw new Error('A data prevista de inicio da oferta e invalida.');
        }
        if (Object.prototype.hasOwnProperty.call(updateData, 'plannedEndDate') && !nextPlannedEndDate) {
            throw new Error('A data prevista de termino da oferta e invalida.');
        }
        if (Object.prototype.hasOwnProperty.call(updateData, 'actualStartDate') && updateData.actualStartDate !== null && !nextActualStartDate) {
            throw new Error('A data real de inicio da oferta e invalida.');
        }
        if (Object.prototype.hasOwnProperty.call(updateData, 'actualEndDate') && updateData.actualEndDate !== null && !nextActualEndDate) {
            throw new Error('A data real de termino da oferta e invalida.');
        }

        validateDateRange(nextPlannedStartDate, nextPlannedEndDate, 'Na oferta tecnica,');
        validateDateRange(nextActualStartDate, nextActualEndDate, 'Na oferta tecnica,');

        const normalizedUpdateData = {
            ...updateData,
            technicalProgramId: nextTechnicalProgramId,
            plannedStartDate: nextPlannedStartDate,
            plannedEndDate: nextPlannedEndDate,
            actualStartDate: nextActualStartDate,
            actualEndDate: nextActualEndDate
        };

        if (Object.prototype.hasOwnProperty.call(normalizedUpdateData, 'defaultSpaceId') && !hasValue(normalizedUpdateData.defaultSpaceId)) {
            normalizedUpdateData.defaultSpaceId = null;
        }

        const updatedOffering = await TechnicalProgramOffering.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { $set: normalizedUpdateData },
            { new: true, runValidators: true }
        ).populate(getOfferingModulePopulation());

        if (!updatedOffering) {
            throw new Error('Oferta tecnica nao encontrada para atualizar.');
        }

        if (datesChanged) {
            await this._recalculateChildModules(updatedOffering);
            await updatedOffering.populate(getOfferingModulePopulation());
        }

        return updatedOffering;
    }
}

module.exports = new TechnicalProgramOfferingService();
