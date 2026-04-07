const studentNoteService = require('../services/studentNote.service');

exports.create = async (req, res) => {
  try {
    const { studentId } = req.params;
    const schoolId = req.user.schoolId || req.user.school_id;
    
    const noteData = {
      ...req.body,
      schoolId,
      studentId: studentId,
      createdBy: req.user.id || req.user._id
    };

    const result = await studentNoteService.createNote(noteData, req.user);

    return res.status(201).json({
      message: 'Anotação criada com sucesso.',
      data: result
    });
  } catch (error) {
    console.error('Erro ao criar anotação:', error);
    return res.status(400).json({ message: error.message || 'Erro interno ao processar anotação.' });
  }
};

exports.listByStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const schoolId = req.user.schoolId || req.user.school_id;
    
    const result = await studentNoteService.listStudentNotes(
      schoolId,
      studentId, 
      req.user
    );

    return res.status(200).json({
      data: result
    });
  } catch (error) {
    console.error('Erro ao listar anotações:', error);
    return res.status(500).json({ message: 'Erro ao buscar anotações do aluno.' });
  }
};

exports.delete = async (req, res) => {
  try {
    const { noteId } = req.params;
    const schoolId = req.user.schoolId || req.user.school_id;

    const result = await studentNoteService.deleteNote(
      schoolId,
      noteId,
      req.user
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error('Erro ao excluir anotação:', error);
    return res.status(400).json({ message: error.message || 'Erro ao excluir anotação.' });
  }
};
