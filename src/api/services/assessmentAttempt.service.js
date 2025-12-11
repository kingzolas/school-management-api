const mongoose = require('mongoose');
const Assessment = require('../models/assessment.model');
const AssessmentAttempt = require('../models/assessmentAttempt.model');
const Student = require('../models/student.model');
// 👇 IMPORTANTE: Importe o model de Matrícula
// Verifique se o nome do arquivo é 'enrollment.model' ou 'enrollments.model' na sua pasta
const Enrollment = require('../models/enrollment.model'); 

class AssessmentAttemptService {

    async listAvailableAssessments(studentId, schoolId) {
        console.log(`🔍 [Service] Buscando atividades para aluno: ${studentId}`);

        // 1. Busca Matrícula Ativa na coleção 'enrollments'
        // Baseado no seu print, o campo que liga é 'student' e o status é 'Ativa'
        const enrollment = await Enrollment.findOne({ 
            student: studentId, 
            status: 'Ativa' 
        });

        if (!enrollment) {
            console.log('⚠️ [Service] Nenhuma matrícula ATIVA encontrada para este aluno.');
            
            // [DEBUG] Tenta achar qualquer matrícula para entender o erro
            const anyEnrollment = await Enrollment.findOne({ student: studentId });
            if (anyEnrollment) {
                console.log(`📦 [DEBUG] Encontrei uma matrícula, mas o status é: '${anyEnrollment.status}' (Esperado: 'Ativa')`);
            }
            return [];
        }

        // Baseado no seu print do Compass, o campo se chama 'class' (ObjectId)
        const classId = enrollment.class;

        if (!classId) {
            console.log('⚠️ [Service] Matrícula encontrada, mas sem ID de turma vinculado.');
            return [];
        }

        console.log(`🎓 [Service] Turma encontrada na matrícula: ${classId}`);

        // 2. Busca TODAS as provas publicadas para essa turma
        const query = {
            school_id: schoolId,
            class_id: classId,
            status: 'PUBLISHED'
        };

        console.log('🔎 [Service] Query Assessment:', JSON.stringify(query));

        const assessments = await Assessment.find(query)
            .select('title topic difficultyLevel deadline subject_id questions')
            .populate('subject_id', 'name')
            .lean();

        console.log(`✅ [Service] Encontradas ${assessments.length} atividades publicadas.`);

        // 3. Busca tentativas deste aluno para essas provas
        const attempts = await AssessmentAttempt.find({
            student_id: studentId,
            assessment_id: { $in: assessments.map(a => a._id) }
        }).lean();

        // 4. Mescla os dados
        return assessments.map(assessment => {
            const attempt = attempts.find(att => att.assessment_id.toString() === assessment._id.toString());
            
            let status = 'PENDING';
            if (attempt) {
                if (attempt.status === 'COMPLETED') status = 'COMPLETED';
                else if (attempt.status === 'IN_PROGRESS') status = 'IN_PROGRESS';
            }

            const subjectName = assessment.subject_id ? assessment.subject_id.name : (assessment.topic || 'Geral');

            return {
                _id: assessment._id,
                title: assessment.title,
                subject: subjectName,
                deadline: assessment.deadline,
                status: status,
                score: attempt ? attempt.score : null,
                attemptId: attempt ? attempt._id : null
            };
        });
    }

    // ... (Mantenha os métodos startAttempt, submitAttempt e getResultsByAssessment iguais) ...
    // Vou repeti-los aqui resumidos para garantir que você não perca nada se copiar/colar tudo:

    async startAttempt(studentId, assessmentId, schoolId) {
        if (!mongoose.isValidObjectId(assessmentId)) throw new Error('ID inválido.');

        const assessment = await Assessment.findOne({ 
            _id: assessmentId, 
            school_id: schoolId, 
            status: 'PUBLISHED' 
        });

        if (!assessment) throw new Error('Atividade indisponível.');

        // Verifica tentativa em andamento (RESUME)
        const attemptInProgress = await AssessmentAttempt.findOne({
            student_id: studentId,
            assessment_id: assessmentId,
            status: 'IN_PROGRESS'
        });

        if (attemptInProgress) return { attemptId: attemptInProgress._id, assessment };

        // Verifica se já finalizou (RETRY check)
        if (!assessment.settings.allowRetry) {
            const attemptCompleted = await AssessmentAttempt.findOne({
                student_id: studentId,
                assessment_id: assessmentId,
                status: 'COMPLETED'
            });
            if (attemptCompleted) throw new Error('Você já realizou esta atividade.');
        }

        // Nova tentativa
        const attempt = new AssessmentAttempt({
            school_id: schoolId,
            student_id: studentId,
            assessment_id: assessmentId,
            class_id: assessment.class_id,
            status: 'IN_PROGRESS',
            telemetry: { startedAt: new Date() }
        });

        await attempt.save();
        return { attemptId: attempt._id, assessment }; 
    }

    async submitAttempt(attemptId, submissionData, schoolId) {
        // ... (seu código de submitAttempt anterior continua igual) ...
        // Para economizar espaço, mantenha a lógica que já tínhamos aqui.
        // Se precisar que eu reescreva essa parte também, me avise.
        
        // CÓDIGO DO SUBMIT RESUMIDO (Mantenha o seu original completo):
        const attempt = await AssessmentAttempt.findOne({ _id: attemptId, school_id: schoolId });
        if (!attempt) throw new Error('Tentativa não encontrada.');
        if (attempt.status === 'COMPLETED') throw new Error('Já finalizada.');

        const assessment = await Assessment.findById(attempt.assessment_id);
        const studentAnswers = submissionData.answers || [];
        
        let correctCount = 0;
        let calculatedScore = 0;
        
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
                isCorrect,
                timeSpentMs: ans.timeSpentMs
            };
        }).filter(a => a !== null);

        attempt.answers = processedAnswers;
        attempt.correctCount = correctCount;
        attempt.score = calculatedScore;
        attempt.status = 'COMPLETED';
        attempt.telemetry = { ...attempt.telemetry, finishedAt: new Date() };

        await attempt.save();
        return attempt;
    }

    async getResultsByAssessment(assessmentId, schoolId) {
        if (!mongoose.isValidObjectId(assessmentId)) throw new Error('ID inválido.');
        return await AssessmentAttempt.find({ assessment_id: assessmentId, school_id: schoolId })
            .populate('student_id', 'fullName enrollmentNumber')
            .sort({ score: -1 });
    }
}

module.exports = new AssessmentAttemptService();