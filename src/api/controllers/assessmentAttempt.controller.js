const AssessmentAttemptService = require('../services/assessmentAttempt.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) throw new Error('Acesso negado: Escola não identificada.');
    return req.user.school_id;
};

class AssessmentAttemptController {

    // Aluno inicia a prova
    async start(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            // studentId vem do middleware auth ajustado
            const studentId = req.user.studentId; 
            const { assessmentId } = req.body;

            if (!studentId) {
                return res.status(403).json({ message: 'Apenas alunos podem iniciar provas.' });
            }

            const result = await AssessmentAttemptService.startAttempt(studentId, assessmentId, schoolId);
            res.status(201).json(result);
        } catch (error) {
            next(error); // Repassa para o middleware de erro padrão
        }
    }

    // Aluno envia a prova
    async submit(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const { attemptId } = req.params;
            const submissionData = req.body; 

            const result = await AssessmentAttemptService.submitAttempt(attemptId, submissionData, schoolId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    // Professor vê resultados
    async getAssessmentResults(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const { assessmentId } = req.params;
            
            const results = await AssessmentAttemptService.getResultsByAssessment(assessmentId, schoolId);
            res.status(200).json(results);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AssessmentAttemptController();