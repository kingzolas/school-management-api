const Assessment = require('../models/assessment.model');
const AssessmentAttempt = require('../models/assessmentAttempt.model');

class AssessmentAttemptService {

    /**
     * Inicia uma tentativa (Aluno abriu a prova)
     */
    async startAttempt(studentId, assessmentId, schoolId) {
        const assessment = await Assessment.findOne({ 
            _id: assessmentId, 
            school_id: schoolId, 
            status: 'PUBLISHED' 
        });

        if (!assessment) throw new Error('Atividade indisponível.');

        // Verifica se já existe tentativa (se não permitir retry)
        if (!assessment.settings.allowRetry) {
            const existing = await AssessmentAttempt.findOne({ student_id: studentId, assessment_id: assessmentId });
            if (existing) throw new Error('Você já realizou esta atividade.');
        }

        // Cria o registro de "Em progresso"
        const attempt = new AssessmentAttempt({
            school_id: schoolId,
            student_id: studentId,
            assessment_id: assessmentId,
            class_id: assessment.class_id,
            status: 'IN_PROGRESS',
            telemetry: {
                startedAt: new Date()
            }
        });

        await attempt.save();
        
        // Retorna a prova para o aluno (O front precisa disso pra renderizar)
        // Importante: O Frontend recebe a prova completa aqui, o backend só valida no final.
        // Se quiser segurança extrema, pode limpar o "correctIndex" aqui, mas dificultaria o feedback imediato no front.
        return { attemptId: attempt._id, assessment }; 
    }

    /**
     * Finaliza a prova (Aluno clicou em Enviar)
     */
    async submitAttempt(attemptId, submissionData, schoolId) {
        const attempt = await AssessmentAttempt.findOne({ _id: attemptId, school_id: schoolId });
        if (!attempt) throw new Error('Tentativa não encontrada.');
        
        if (attempt.status === 'COMPLETED') throw new Error('Esta tentativa já foi finalizada.');

        const assessment = await Assessment.findById(attempt.assessment_id);

        // Lógica de Correção (Servidor é autoridade)
        const studentAnswers = submissionData.answers || []; // Array vindo do Front
        let correctCount = 0;
        let calculatedScore = 0;
        
        // Processa cada resposta
        const processedAnswers = studentAnswers.map(ans => {
            const questionConfig = assessment.questions[ans.questionIndex];
            
            // Segurança: Verifica se a questão existe
            if (!questionConfig) return null;

            const isCorrect = questionConfig.correctIndex === ans.selectedOptionIndex;
            if (isCorrect) {
                correctCount++;
                calculatedScore += questionConfig.points; // Soma pontos
            }

            return {
                questionIndex: ans.questionIndex,
                selectedOptionIndex: ans.selectedOptionIndex,
                isCorrect: isCorrect,
                timeSpentMs: ans.timeSpentMs,
                switchedAppCount: ans.switchedAppCount
            };
        }).filter(a => a !== null);

        // Atualiza o documento
        attempt.answers = processedAnswers;
        attempt.correctCount = correctCount;
        attempt.score = calculatedScore;
        attempt.totalQuestions = assessment.questions.length;
        attempt.status = 'COMPLETED';
        
        // Telemetria Geral
        attempt.telemetry = {
            ...attempt.telemetry,
            finishedAt: new Date(),
            totalTimeMs: submissionData.telemetry.totalTimeMs,
            focusLostCount: submissionData.telemetry.focusLostCount,
            focusLostTimeMs: submissionData.telemetry.focusLostTimeMs,
            browserUserAgent: submissionData.telemetry.deviceInfo
        };

        await attempt.save();
        return attempt;
    }
    
    /**
     * Dashboard: Pega resultados de uma prova específica (Para o Professor)
     */
    async getResultsByAssessment(assessmentId, schoolId) {
        return await AssessmentAttempt.find({ assessment_id: assessmentId, school_id: schoolId })
            .populate('student_id', 'fullName enrollmentNumber') // Traz nome do aluno
            .sort({ score: -1 });
    }
}

module.exports = new AssessmentAttemptService();