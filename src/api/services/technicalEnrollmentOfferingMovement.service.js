const TechnicalEnrollmentOfferingMovement = require('../models/technicalEnrollmentOfferingMovement.model');
const TechnicalEnrollment = require('../models/technicalEnrollment.model');
const TechnicalProgramOffering = require('../models/technicalProgramOffering.model');
const User = require('../models/user.model');

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const population = [
    {
        path: 'technicalEnrollmentId',
        select: 'studentId companyId technicalProgramId currentTechnicalProgramOfferingId currentClassId enrollmentDate status',
        populate: [
            { path: 'studentId', select: 'fullName birthDate cpf' },
            { path: 'companyId', select: 'name legalName cnpj' },
            { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
            {
                path: 'currentTechnicalProgramOfferingId',
                select: 'technicalProgramId name code status plannedStartDate plannedEndDate actualStartDate actualEndDate shift capacity defaultSpaceId',
                populate: [
                    { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
                    { path: 'defaultSpaceId', select: 'name type capacity status' }
                ]
            },
            { path: 'currentClassId', select: 'name schoolYear grade shift' }
        ]
    },
    {
        path: 'fromTechnicalProgramOfferingId',
        select: 'technicalProgramId name code status plannedStartDate plannedEndDate actualStartDate actualEndDate shift capacity defaultSpaceId',
        populate: [
            { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
            { path: 'defaultSpaceId', select: 'name type capacity status' }
        ]
    },
    {
        path: 'toTechnicalProgramOfferingId',
        select: 'technicalProgramId name code status plannedStartDate plannedEndDate actualStartDate actualEndDate shift capacity defaultSpaceId',
        populate: [
            { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
            { path: 'defaultSpaceId', select: 'name type capacity status' }
        ]
    },
    {
        path: 'performedByUserId',
        select: 'fullName email roles status'
    }
];

class TechnicalEnrollmentOfferingMovementService {
    async createTechnicalEnrollmentOfferingMovement(movementData, schoolId, performedByUserId = null) {
        const {
            technicalEnrollmentId,
            toTechnicalProgramOfferingId,
            reason,
            notes,
            movedAt
        } = movementData;

        const enrollment = await TechnicalEnrollment.findOne({
            _id: technicalEnrollmentId,
            school_id: schoolId
        });

        if (!enrollment) {
            throw new Error('Matricula tecnica nao encontrada ou nao pertence a esta escola.');
        }

        const toOffering = await TechnicalProgramOffering.findOne({
            _id: toTechnicalProgramOfferingId,
            school_id: schoolId
        });

        if (!toOffering) {
            throw new Error('Oferta tecnica de destino nao encontrada ou nao pertence a esta escola.');
        }

        if (String(toOffering.technicalProgramId) !== String(enrollment.technicalProgramId)) {
            throw new Error('A oferta tecnica de destino nao pertence ao programa tecnico da matricula.');
        }

        const fromOfferingId = hasValue(enrollment.currentTechnicalProgramOfferingId)
            ? String(enrollment.currentTechnicalProgramOfferingId)
            : null;
        const targetOfferingId = String(toOffering._id);

        if (fromOfferingId && fromOfferingId === targetOfferingId) {
            throw new Error('A matricula ja esta vinculada a esta oferta tecnica.');
        }

        let validatedPerformedByUserId = null;
        if (hasValue(performedByUserId)) {
            const performer = await User.findOne({
                _id: performedByUserId,
                school_id: schoolId,
                status: 'Ativo'
            }).select('_id fullName email roles status');

            if (!performer) {
                throw new Error('O usuario responsavel pela movimentacao nao foi encontrado, nao pertence a esta escola ou esta inativo.');
            }

            validatedPerformedByUserId = performer._id;
        }

        const movementType = fromOfferingId ? 'Transferencia' : 'AtribuicaoInicial';
        const normalizedMovedAt = hasValue(movedAt) ? new Date(movedAt) : new Date();
        if (Number.isNaN(normalizedMovedAt.getTime())) {
            throw new Error('A data da movimentacao e invalida.');
        }

        const movement = new TechnicalEnrollmentOfferingMovement({
            technicalEnrollmentId,
            fromTechnicalProgramOfferingId: fromOfferingId,
            toTechnicalProgramOfferingId: targetOfferingId,
            movementType,
            movedAt: normalizedMovedAt,
            reason,
            notes,
            performedByUserId: validatedPerformedByUserId,
            school_id: schoolId
        });

        await movement.save();

        try {
            enrollment.currentTechnicalProgramOfferingId = targetOfferingId;
            enrollment.status = 'Ativa';
            await enrollment.save();

            await movement.populate(population);
            return movement;
        } catch (error) {
            await TechnicalEnrollmentOfferingMovement.deleteOne({ _id: movement._id, school_id: schoolId });
            throw error;
        }
    }

    async getAllTechnicalEnrollmentOfferingMovements(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await TechnicalEnrollmentOfferingMovement.find({
            ...query,
            school_id: schoolId
        })
            .populate(population)
            .sort({ movedAt: -1, createdAt: -1 });
    }

    async getTechnicalEnrollmentOfferingMovementById(id, schoolId) {
        const movement = await TechnicalEnrollmentOfferingMovement.findOne({
            _id: id,
            school_id: schoolId
        }).populate(population);

        if (!movement) {
            throw new Error('Movimentacao de oferta tecnica nao encontrada ou nao pertence a esta escola.');
        }

        return movement;
    }
}

module.exports = new TechnicalEnrollmentOfferingMovementService();
