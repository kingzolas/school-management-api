const ResourceOccupancyService = require('../services/resourceOccupancy.service');
const { formatApiError } = require('../utils/apiError');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuario nao autenticado ou nao associado a uma escola.');
    }

    return req.user.school_id;
};

class ResourceOccupancyController {
    async getAll(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const occupancy = await ResourceOccupancyService.getResourceOccupancy(schoolId, req.query);

            res.status(200).json(occupancy);
        } catch (error) {
            const { status, body } = formatApiError(error);
            res.status(status).json(body);
        }
    }

    async preview(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const preview = await ResourceOccupancyService.previewScheduleSlotPublication(req.body, schoolId);

            res.status(200).json(preview);
        } catch (error) {
            const { status, body } = formatApiError(error);
            res.status(status).json(body);
        }
    }
}

module.exports = new ResourceOccupancyController();
