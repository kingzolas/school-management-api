const mongoose = require('mongoose'); // [IMPORTANTE] Necessário para validar ID
const Assessment = require('../models/assessment.model');
const AssessmentAttempt = require('../models/assessmentAttempt.model');

class AssessmentAttemptService {

    /**
     * Inicia uma tentativa (Aluno abriu a prova)
     */
    async startAttempt(studentId, assessmentId, schoolId) {
        // [CORREÇÃO] Valida se o ID é um formato válido do MongoDB (24 chars hex)
        // Isso evita o CastError e o crash 500 se o link estiver quebrado
        if (!mongoose.isValidObjectId(assessmentId)) {
            throw new Error('Link da atividade inválido (ID incorreto).');
        }

        const assessment = await Assessment.findOne({ 
            _id: assessmentId, 
            school_id: schoolId, 
            status: 'PUBLISHED' 
        });

        if (!assessment) throw new Error('Atividade indisponível ou não encontrada.');

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
        
        return { attemptId: attempt._id, assessment }; 
    }

    /**
     * Finaliza a prova (Aluno clicou em Enviar)
     */
    async submitAttempt(attemptId, submissionData, schoolId) {
        if (!mongoose.isValidObjectId(attemptId)) {
            throw new Error('ID da tentativa inválido.');
        }

        const attempt = await AssessmentAttempt.findOne({ _id: attemptId, school_id: schoolId });
        if (!attempt) throw new Error('Tentativa não encontrada.');
        
        if (attempt.status === 'COMPLETED') throw new Error('Esta tentativa já foi finalizada.');

        const assessment = await Assessment.findById(attempt.assessment_id);

        // Lógica de Correção
        const studentAnswers = submissionData.answers || []; 
        let correctCount = 0;
        let calculatedScore = 0;
        
        // Processa cada resposta
        const processedAnswers = studentAnswers.map(ans => {
            const questionConfig = assessment.questions[ans.questionIndex];
            
            if (!questionConfig) return null;

            const isCorrect = questionConfig.correctIndex === ans.selectedOptionIndex;
            if (isCorrect) {
                correctCount++;
                calculatedScore += questionConfig.points; 
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
            deviceInfo: submissionData.telemetry.deviceInfo
        };

        await attempt.save();
        return attempt;
    }
    
    /**
     * Dashboard: Pega resultados de uma prova específica
     */
    async getResultsByAssessment(assessmentId, schoolId) {
        if (!mongoose.isValidObjectId(assessmentId)) {
            throw new Error('ID da atividade inválido.');
        }

        return await AssessmentAttempt.find({ assessment_id: assessmentId, school_id: schoolId })
            .populate('student_id', 'fullName enrollmentNumber') 
            .sort({ score: -1 });
    }
}

module.exports = new AssessmentAttemptService();