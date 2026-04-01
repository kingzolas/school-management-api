const TechnicalProgramModuleService = require('../services/technicalProgramModule.service');
const TechnicalTeacherEligibilityService = require('../services/technicalTeacherEligibility.service');
const { formatApiError } = require('../utils/apiError');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuário não autenticado ou não associado a uma escola.');
    }

    return req.user.school_id;
};

class TechnicalProgramModuleController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const module = await TechnicalProgramModuleService.createTechnicalProgramModule(req.body, schoolId);

            res.status(201).json(module);
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
            const modules = await TechnicalProgramModuleService.getAllTechnicalProgramModules(req.query, schoolId);

            res.status(200).json(modules);
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
            const module = await TechnicalProgramModuleService.getTechnicalProgramModuleById(req.params.id, schoolId);

            res.status(200).json(module);
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
            const updatedModule = await TechnicalProgramModuleService.updateTechnicalProgramModule(
                req.params.id,
                req.body,
                schoolId
            );

            res.status(200).json(updatedModule);
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

    async inactivate(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const module = await TechnicalProgramModuleService.inactivateTechnicalProgramModule(req.params.id, schoolId);

            res.status(200).json({ message: 'Módulo técnico inativado com sucesso', module });
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async getSchedulingContext(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const context = await TechnicalTeacherEligibilityService.getTechnicalProgramModuleSchedulingContext(req.params.id, schoolId);

            res.status(200).json(context);
        } catch (error) {
            const { status, body } = formatApiError(error);
            res.status(status).json(body);
        }
    }
}

module.exports = new TechnicalProgramModuleController();
