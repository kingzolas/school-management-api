const Assessment = require('../models/assessment.model');
const GeminiQuizService = require('./geminiQuiz.service');
const appEmitter = require('../../loaders/eventEmitter');

class AssessmentService {

    /**
     * Cria um Rascunho (DRAFT) usando o Gemini
     */
    async createDraftWithAI(data, schoolId, teacherId) {
        const { topic, difficultyLevel, quantity, classId, subjectId, description } = data;

        // 1. Gera as questões na IA
        // Passamos o description como contexto extra se existir
        const contextData = description ? { description } : {};
        const questions = await GeminiQuizService.generateQuizJson(topic, difficultyLevel, quantity, contextData);

        // 2. Salva como Rascunho
        const assessment = new Assessment({
            title: `Atividade: ${topic}`,
            topic,
            difficultyLevel,
            school_id: schoolId,
            class_id: classId,
            teacher_id: teacherId,
            subject_id: subjectId,
            questions: questions,
            description: description,
            status: 'DRAFT' // Nasce como rascunho
        });

        await assessment.save();
        return assessment;
    }

    /**
     * Atualiza/Edita o rascunho (Professor fazendo curadoria)
     */
    async updateAssessment(id, updateData, schoolId) {
        const assessment = await Assessment.findOne({ _id: id, school_id: schoolId });
        
        if (!assessment) {
            throw new Error('Atividade não encontrada ou acesso negado.');
        }

        if (assessment.status === 'CLOSED') {
            throw new Error('Não é possível editar uma atividade encerrada.');
        }

        Object.assign(assessment, updateData);
        await assessment.save();
        return assessment;
    }

    /**
     * Publica a atividade (Libera para alunos)
     */
   async publishAssessment(id, schoolId) {
        const assessment = await Assessment.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { status: 'PUBLISHED' },
            { new: true }
        );

        if (!assessment) throw new Error('Atividade não encontrada.');

        // 🔥 [NOVO] Emite o evento para o WebSocket pegar
        appEmitter.emit('assessment:published', assessment);

        return assessment;
    }

    /**
     * Lista atividades de uma turma
     * [CORREÇÃO] Removido filtro 'status: PUBLISHED' para que o professor veja os RASCUNHOS
     */
    async getByClass(classId, schoolId) {
        return await Assessment.find({ 
            class_id: classId, 
            school_id: schoolId,
            // status: 'PUBLISHED' // <--- REMOVIDO: O professor precisa ver DRAFTs também
        })
        .sort({ createdAt: -1 }) // Ordena: Mais recentes primeiro
        .select('-questions.correctIndex -questions.explanation'); 
    }

    /**
     * Pega detalhes completos (Para o Professor ou para iniciar a prova)
     */
    async getById(id, schoolId) {
        const assessment = await Assessment.findOne({ _id: id, school_id: schoolId });
        if (!assessment) throw new Error('Atividade não encontrada.');
        return assessment;
    }
}

module.exports = new AssessmentService();