const TechnicalClassMovement = require('../models/technicalClassMovement.model');
const TechnicalEnrollment = require('../models/technicalEnrollment.model');
const Class = require('../models/class.model');

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
    { path: 'fromClassId', select: 'name schoolYear grade shift' },
    { path: 'toClassId', select: 'name schoolYear grade shift' },
    { path: 'performedByUserId', select: 'fullName username roles' }
];

class TechnicalClassMovementService {
    async createTechnicalClassMovement(movementData, schoolId, performedByUserId = null) {
        const { technicalEnrollmentId, toClassId, reason, notes, movedAt } = movementData;

        const enrollment = await TechnicalEnrollment.findOne({
            _id: technicalEnrollmentId,
            school_id: schoolId
        });

        if (!enrollment) {
            throw new Error('Matrícula técnica não encontrada ou não pertence a esta escola.');
        }

        const currentClassId = enrollment.currentClassId;
        if (!currentClassId) {
            throw new Error('A matrícula técnica não possui turma atual para movimentação.');
        }

        const fromClass = await Class.findOne({ _id: currentClassId, school_id: schoolId });
        if (!fromClass) {
            throw new Error('Turma de origem não encontrada ou não pertence a esta escola.');
        }

        const toClass = await Class.findOne({ _id: toClassId, school_id: schoolId });
        if (!toClass) {
            throw new Error('Turma de destino não encontrada ou não pertence a esta escola.');
        }

        if (String(fromClass._id) === String(toClass._id)) {
            throw new Error('A turma de origem e a de destino não podem ser iguais.');
        }

        const movement = new TechnicalClassMovement({
            technicalEnrollmentId,
            fromClassId: fromClass._id,
            toClassId: toClass._id,
            movedAt: movedAt ? new Date(movedAt) : new Date(),
            reason,
            notes,
            performedByUserId,
            school_id: schoolId
        });

        await movement.save();

        try {
            const updatedEnrollment = await TechnicalEnrollment.findOneAndUpdate(
                { _id: technicalEnrollmentId, school_id: schoolId },
                { $set: { currentClassId: toClass._id } },
                { new: true, runValidators: true }
            );

            if (!updatedEnrollment) {
                throw new Error('Não foi possível atualizar a turma atual da matrícula técnica.');
            }
        } catch (error) {
            await TechnicalClassMovement.findByIdAndDelete(movement._id);
            throw error;
        }

        await movement.populate(defaultPopulation);
        return movement;
    }

    async getAllTechnicalClassMovements(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await TechnicalClassMovement.find({
            ...query,
            school_id: schoolId
        })
            .populate(defaultPopulation)
            .sort({ movedAt: -1 });
    }

    async getTechnicalClassMovementById(id, schoolId) {
        const movement = await TechnicalClassMovement.findOne({
            _id: id,
            school_id: schoolId
        }).populate(defaultPopulation);

        if (!movement) {
            throw new Error('Movimentação de turma não encontrada ou não pertence a esta escola.');
        }

        return movement;
    }
}

module.exports = new TechnicalClassMovementService();
