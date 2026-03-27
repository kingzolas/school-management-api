const TechnicalProgramOfferingService = require('../services/technicalProgramOffering.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuario nao autenticado ou nao associado a uma escola.');
    }

    return req.user.school_id;
};

class TechnicalProgramOfferingController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const offering = await TechnicalProgramOfferingService.createTechnicalProgramOffering(req.body, schoolId);

            res.status(201).json(offering);
        } catch (error) {
            if (error.message.includes('nao autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('ja existe')) {
                return res.status(409).json({ message: error.message });
            }
            if (error.message.includes('nao encontrado')) {
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
            const offerings = await TechnicalProgramOfferingService.getAllTechnicalProgramOfferings(req.query, schoolId);

            res.status(200).json(offerings);
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
            const offering = await TechnicalProgramOfferingService.getTechnicalProgramOfferingById(req.params.id, schoolId);

            res.status(200).json(offering);
        } catch (error) {
            if (error.message.includes('nao autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('nao encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const updatedOffering = await TechnicalProgramOfferingService.updateTechnicalProgramOffering(
                req.params.id,
                req.body,
                schoolId
            );

            res.status(200).json(updatedOffering);
        } catch (error) {
            if (error.message.includes('nao autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('nao encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('ja existe')) {
                return res.status(409).json({ message: error.message });
            }
            if (error.name === 'ValidationError') {
                return res.status(400).json({ message: 'Erro de validacao.', error: error.message });
            }
            next(error);
        }
    }
}

module.exports = new TechnicalProgramOfferingController();
