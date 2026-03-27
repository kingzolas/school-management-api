const TechnicalProgramOfferingModuleService = require('../services/technicalProgramOfferingModule.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuario nao autenticado ou nao associado a uma escola.');
    }

    return req.user.school_id;
};

class TechnicalProgramOfferingModuleController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const module = await TechnicalProgramOfferingModuleService.createTechnicalProgramOfferingModule(req.body, schoolId);

            res.status(201).json(module);
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
            const modules = await TechnicalProgramOfferingModuleService.getAllTechnicalProgramOfferingModules(req.query, schoolId);

            res.status(200).json(modules);
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
            const module = await TechnicalProgramOfferingModuleService.getTechnicalProgramOfferingModuleById(req.params.id, schoolId);

            res.status(200).json(module);
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
            const updatedModule = await TechnicalProgramOfferingModuleService.updateTechnicalProgramOfferingModule(
                req.params.id,
                req.body,
                schoolId
            );

            res.status(200).json(updatedModule);
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
            const module = await TechnicalProgramOfferingModuleService.inactivateTechnicalProgramOfferingModule(req.params.id, schoolId);

            res.status(200).json({ message: 'Execucao do modulo da oferta cancelada com sucesso', module });
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

module.exports = new TechnicalProgramOfferingModuleController();
