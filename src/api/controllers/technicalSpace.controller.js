const TechnicalSpaceService = require('../services/technicalSpace.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuario nao autenticado ou nao associado a uma escola.');
    }

    return req.user.school_id;
};

class TechnicalSpaceController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const space = await TechnicalSpaceService.createTechnicalSpace(req.body, schoolId);

            res.status(201).json(space);
        } catch (error) {
            if (error.message.includes('nao autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.code === 11000 || error.message.includes('ja existe')) {
                return res.status(409).json({ message: error.message });
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
            const spaces = await TechnicalSpaceService.getAllTechnicalSpaces(req.query, schoolId);

            res.status(200).json(spaces);
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
            const space = await TechnicalSpaceService.getTechnicalSpaceById(req.params.id, schoolId);

            res.status(200).json(space);
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
            const updatedSpace = await TechnicalSpaceService.updateTechnicalSpace(req.params.id, req.body, schoolId);

            res.status(200).json(updatedSpace);
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

    async inactivate(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const space = await TechnicalSpaceService.inactivateTechnicalSpace(req.params.id, schoolId);

            res.status(200).json({ message: 'Espaco tecnico inativado com sucesso', space });
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
}

module.exports = new TechnicalSpaceController();
