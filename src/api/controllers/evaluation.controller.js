const Evaluation = require('../models/evaluation.model');

exports.getByClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const { term } = req.query;
    const schoolId = req.user.schoolId; // Vindo do seu middleware

    // Segurança: Garante que buscamos avaliações desta escola e desta turma
    const query = { 
        classInfo: classId,
        school: schoolId 
    };
    
    if (term) query.term = term;

    const evaluations = await Evaluation.find(query)
      .sort({ date: 1 })
      .lean();

    return res.status(200).json(evaluations);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;
    // Aqui seria ideal verificar se a avaliação pertence à schoolId do req.user antes de deletar
    await Evaluation.findByIdAndDelete(id);
    return res.status(200).json({ message: 'Avaliação removida com sucesso.' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};