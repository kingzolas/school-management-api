const TechnicalProgramOfferingModuleService = require('../services/technicalProgramOfferingModule.service');
const ResourceOccupancyService = require('../services/resourceOccupancy.service');
const { formatApiError } = require('../utils/apiError');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuario nao autenticado ou nao associado a uma escola.');
    }

    return req.user.school_id;
};

const getPerformedByUserId = (req) => req.user?.id || req.user?._id || null;

const sendFormattedError = (res, error) => {
    const { status, body } = formatApiError(error);
    return res.status(status).json(body);
};

class TechnicalProgramOfferingModuleController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const module = await TechnicalProgramOfferingModuleService.createTechnicalProgramOfferingModule(req.body, schoolId);

            res.status(201).json(module);
        } catch (error) {
            sendFormattedError(res, error);
        }
    }

    async getAll(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const modules = await TechnicalProgramOfferingModuleService.getAllTechnicalProgramOfferingModules(req.query, schoolId);

            res.status(200).json(modules);
        } catch (error) {
            sendFormattedError(res, error);
        }
    }

    async getById(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const module = await TechnicalProgramOfferingModuleService.getTechnicalProgramOfferingModuleById(req.params.id, schoolId);

            res.status(200).json(module);
        } catch (error) {
            sendFormattedError(res, error);
        }
    }

    async update(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const updatedModule = await TechnicalProgramOfferingModuleService.updateTechnicalProgramOfferingModule(
                req.params.id,
                req.body,
                schoolId,
                getPerformedByUserId(req)
            );

            res.status(200).json(updatedModule);
        } catch (error) {
            sendFormattedError(res, error);
        }
    }

    async inactivate(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const module = await TechnicalProgramOfferingModuleService.inactivateTechnicalProgramOfferingModule(req.params.id, schoolId);

            res.status(200).json({ message: 'Execucao do modulo da oferta cancelada com sucesso', module });
        } catch (error) {
            sendFormattedError(res, error);
        }
    }

    async publishScheduleSlot(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const performedByUserId = getPerformedByUserId(req);
            const updatedModule = await ResourceOccupancyService.publishScheduleSlot(
                req.params.id,
                req.params.slotId,
                schoolId,
                performedByUserId
            );

            res.status(200).json(updatedModule);
        } catch (error) {
            sendFormattedError(res, error);
        }
    }
}

module.exports = new TechnicalProgramOfferingModuleController();
