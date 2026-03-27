const TechnicalModuleRecordService = require('../services/technicalModuleRecord.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuário não autenticado ou não associado a uma escola.');
    }

    return req.user.school_id;
};

class TechnicalModuleRecordController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const record = await TechnicalModuleRecordService.createTechnicalModuleRecord(req.body, schoolId);

            res.status(201).json(record);
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

    async getAll(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const records = await TechnicalModuleRecordService.getAllTechnicalModuleRecords(req.query, schoolId);

            res.status(200).json(records);
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
            const record = await TechnicalModuleRecordService.getTechnicalModuleRecordById(req.params.id, schoolId);

            res.status(200).json(record);
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
            const updatedRecord = await TechnicalModuleRecordService.updateTechnicalModuleRecord(
                req.params.id,
                req.body,
                schoolId
            );

            res.status(200).json(updatedRecord);
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

module.exports = new TechnicalModuleRecordController();
