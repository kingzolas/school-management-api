const GradebookService = require('../services/gradebook.service');
const Grade = require('../models/grade.model');

exports.saveBulkGrades = async (req, res) => {
  try {
    const { classId, evaluation, grades } = req.body;
    
    // --- INTEGRAÇÃO COM SEU MIDDLEWARE ---
    // O middleware garante que 'id' e 'schoolId' estejam em req.user
    const teacherId = req.user.id; 
    const schoolId = req.user.schoolId; // A correção crítica do seu middleware

    if (!classId || !evaluation || !grades) {
      return res.status(400).json({ error: 'Dados incompletos para lançamento.' });
    }

    // Passamos o schoolId para o serviço garantir que a avaliação seja criada na escola certa
    const savedEvaluation = await GradebookService.saveClassGrades({
      schoolId, 
      classId,
      teacherId,
      evaluationData: evaluation,
      gradesList: grades
    });

    return res.status(200).json({ 
      message: 'Notas salvas com sucesso!',
      evaluation: savedEvaluation
    });

  } catch (error) {
    console.error("Erro ao salvar notas:", error);
    return res.status(500).json({ error: error.message || 'Erro interno.' });
  }
};

exports.getGradesByClass = async (req, res) => {
  try {
    const { classId } = req.params;
    
    // Opcional: Adicionar validação se a turma pertence à escola do usuário
    // const schoolId = req.user.schoolId; 

    const grades = await Grade.find({ })
      .populate({
        path: 'evaluation',
        match: { classInfo: classId },
        select: 'title term type date maxScore'
      })
      .lean();

    const filteredGrades = grades.filter(g => g.evaluation !== null);

    return res.status(200).json(filteredGrades);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};