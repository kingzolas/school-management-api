const TechnicalProgramService = require('../services/technicalProgram.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuário não autenticado ou não associado a uma escola.');
    }

    return req.user.school_id;
};

class TechnicalProgramController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const program = await TechnicalProgramService.createTechnicalProgram(req.body, schoolId);

            res.status(201).json(program);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.code === 11000 || error.message.includes('já existe')) {
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
            const programs = await TechnicalProgramService.getAllTechnicalPrograms(req.query, schoolId);

            res.status(200).json(programs);
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
            const program = await TechnicalProgramService.getTechnicalProgramById(req.params.id, schoolId);

            res.status(200).json(program);
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

    async update(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const updatedProgram = await TechnicalProgramService.updateTechnicalProgram(req.params.id, req.body, schoolId);

            res.status(200).json(updatedProgram);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrado')) {
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
            const program = await TechnicalProgramService.inactivateTechnicalProgram(req.params.id, schoolId);

            res.status(200).json({ message: 'Programa técnico inativado com sucesso', program });
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
}

module.exports = new TechnicalProgramController();
