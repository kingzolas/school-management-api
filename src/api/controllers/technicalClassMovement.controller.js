const TechnicalClassMovementService = require('../services/technicalClassMovement.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuário não autenticado ou não associado a uma escola.');
    }

    return req.user.school_id;
};

class TechnicalClassMovementController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const movement = await TechnicalClassMovementService.createTechnicalClassMovement(
                req.body,
                schoolId,
                req.user.id
            );

            res.status(201).json(movement);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontr')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('não podem ser iguais')) {
                return res.status(400).json({ message: error.message });
            }
            next(error);
        }
    }

    async getAll(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const movements = await TechnicalClassMovementService.getAllTechnicalClassMovements(req.query, schoolId);

            res.status(200).json(movements);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const movement = await TechnicalClassMovementService.getTechnicalClassMovementById(req.params.id, schoolId);

            res.status(200).json(movement);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontr')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }
}

module.exports = new TechnicalClassMovementController();
