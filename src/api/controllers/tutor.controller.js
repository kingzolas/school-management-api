// src/api/controllers/tutor.controller.js
const TutorService = require('../services/tutor.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuário não autenticado ou não associado a uma escola.');
    }
    return req.user.school_id;
};

class TutorController {

    async getAll(req, res) {
        try {
            const schoolId = getSchoolId(req);
            const tutors = await TutorService.getAllTutors(schoolId);
            res.status(200).json(tutors);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao buscar todos os tutores', error: error.message });
        }
    }

    async update(req, res) {
        try {
            const schoolId = getSchoolId(req);
            const id = req.params.id;
            const tutorData = req.body;

            console.log(`[API] Recebida requisição PUT para tutor ID: ${id}`);

            const updatedTutor = await TutorService.updateTutor(id, tutorData, schoolId);

            res.status(200).json(updatedTutor);
        } catch (error) {
            console.error(`[API] Erro ao processar PUT para tutor: ${error.message}`);
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao atualizar tutor', error: error.message });
        }
    }

    async getById(req, res) {
        try {
            const schoolId = getSchoolId(req);
            const id = req.params.id;

            const tutor = await TutorService.getTutorById(id, schoolId);

            res.status(200).json(tutor);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao buscar tutor por ID', error: error.message });
        }
    }

    async findByCpf(req, res) {
        try {
            const schoolId = getSchoolId(req);
            const cpf = req.params.cpf;
            console.log(`[API] Recebida busca por CPF: ${cpf}`);

            const tutor = await TutorService.findTutorByCpf(cpf, schoolId);

            if (!tutor) {
                console.log(`[API] CPF ${cpf} não encontrado no banco.`);
                return res.status(404).json({ message: 'Tutor não encontrado.' });
            }

            console.log(`[API] CPF ${cpf} encontrado. Enviando dados...`);
            res.status(200).json(tutor);

        } catch (error) {
            console.error(`[API] Erro ao processar busca por CPF: ${error.message}`);
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao buscar tutor por CPF', error: error.message });
        }
    }

    async getFinancialScore(req, res) {
        try {
            const schoolId = getSchoolId(req);
            const id = req.params.id;

            const financialScore = await TutorService.getTutorFinancialScore(id, schoolId);

            res.status(200).json(financialScore);
        } catch (error) {
            console.error(`[API] Erro ao buscar financialScore do tutor: ${error.message}`);
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao buscar financialScore do tutor', error: error.message });
        }
    }

    async updateFinancialScore(req, res) {
        try {
            const schoolId = getSchoolId(req);
            const id = req.params.id;
            const financialScoreData = req.body;

            const updatedTutor = await TutorService.updateTutorFinancialScore(id, financialScoreData, schoolId);

            res.status(200).json(updatedTutor);
        } catch (error) {
            console.error(`[API] Erro ao atualizar financialScore do tutor: ${error.message}`);
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao atualizar financialScore do tutor', error: error.message });
        }
    }

    async recalculateFinancialScore(req, res) {
        try {
            const schoolId = getSchoolId(req);
            const id = req.params.id;

            const updatedTutor = await TutorService.recalculateTutorFinancialScore(id, schoolId);

            res.status(200).json(updatedTutor);
        } catch (error) {
            console.error(`[API] Erro ao recalcular financialScore do tutor: ${error.message}`);
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao recalcular financialScore do tutor', error: error.message });
        }
    }

    async backfillFinancialScore(req, res) {
        try {
            const schoolId = getSchoolId(req);

            const result = await TutorService.backfillTutorsFinancialScore(schoolId);

            res.status(200).json({
                message: 'Backfill do financialScore executado com sucesso.',
                ...result
            });
        } catch (error) {
            console.error(`[API] Erro ao executar backfill do financialScore: ${error.message}`);
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao executar backfill do financialScore', error: error.message });
        }
    }
}

module.exports = new TutorController();