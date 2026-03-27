const TechnicalEnrollmentOfferingMovementService = require('../services/technicalEnrollmentOfferingMovement.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuario nao autenticado ou nao associado a uma escola.');
    }

    return req.user.school_id;
};

class TechnicalEnrollmentOfferingMovementController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const performedByUserId = req.user?.id || req.user?._id || null;
            const movement = await TechnicalEnrollmentOfferingMovementService.createTechnicalEnrollmentOfferingMovement(
                req.body,
                schoolId,
                performedByUserId
            );

            res.status(201).json(movement);
        } catch (error) {
            if (error.message.includes('nao autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('ja esta vinculada')) {
                return res.status(409).json({ message: error.message });
            }
            if (error.message.includes('nao encontr') || error.message.includes('inativo')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.name === 'ValidationError') {
                return res.status(400).json({ message: 'Erro de validacao.', error: error.message });
            }
            next(error);
        }
    }

    async getAll(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const movements = await TechnicalEnrollmentOfferingMovementService.getAllTechnicalEnrollmentOfferingMovements(req.query, schoolId);

            res.status(200).json(movements);
        } catch (error) {
            if (error.message.includes('nao autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const movement = await TechnicalEnrollmentOfferingMovementService.getTechnicalEnrollmentOfferingMovementById(req.params.id, schoolId);

            res.status(200).json(movement);
        } catch (error) {
            if (error.message.includes('nao autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('nao encontr')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }
}

module.exports = new TechnicalEnrollmentOfferingMovementController();
