const TechnicalEnrollmentService = require('../services/technicalEnrollment.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuário não autenticado ou não associado a uma escola.');
    }

    return req.user.school_id;
};

class TechnicalEnrollmentController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const enrollment = await TechnicalEnrollmentService.createTechnicalEnrollment(req.body, schoolId);

            res.status(201).json(enrollment);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('já existe')) {
                return res.status(409).json({ message: error.message });
            }
            if (error.message.includes('não encontr')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.name === 'ValidationError') {
                return res.status(400).json({ message: 'Erro de validação.', error: error.message });
            }
            next(error);
        }
    }

    async getAll(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const enrollments = await TechnicalEnrollmentService.getAllTechnicalEnrollments(req.query, schoolId);

            res.status(200).json(enrollments);
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
            const enrollment = await TechnicalEnrollmentService.getTechnicalEnrollmentById(req.params.id, schoolId);

            res.status(200).json(enrollment);
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

    async update(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const updatedEnrollment = await TechnicalEnrollmentService.updateTechnicalEnrollment(
                req.params.id,
                req.body,
                schoolId
            );

            res.status(200).json(updatedEnrollment);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontr')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('já existe')) {
                return res.status(409).json({ message: error.message });
            }
            if (error.name === 'ValidationError') {
                return res.status(400).json({ message: 'Erro de validação.', error: error.message });
            }
            next(error);
        }
    }
}

module.exports = new TechnicalEnrollmentController();
