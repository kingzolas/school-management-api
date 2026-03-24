const StudentNote = require('../models/studentNote.model');

// Utilitário para verificar permissões de visualização
function canViewAllNotes(user) {
  const roles = [];
  if (Array.isArray(user.roles)) roles.push(...user.roles);
  if (user.role) roles.push(user.role);
  if (user.profile) roles.push(user.profile);

  const userRoles = roles.map((r) => String(r).trim().toLowerCase());
  return userRoles.some((role) => ['admin', 'coordenador', 'gestor', 'secretaria'].includes(role));
}

exports.createNote = async (data) => {
  const { schoolId, studentId, createdBy, type, title, description } = data;

  if (!schoolId || !studentId || !createdBy || !title || !description) {
    throw new Error('Parâmetros obrigatórios ausentes (schoolId, studentId, createdBy, title, description).');
  }

  const note = await StudentNote.create({
    schoolId,
    studentId,
    createdBy,
    type: type || 'PRIVATE',
    title,
    description
  });

  return StudentNote.findById(note._id)
    .populate('createdBy', 'fullName profilePictureUrl')
    .populate('studentId', 'fullName enrollmentNumber');
};

exports.listStudentNotes = async (schoolId, studentId, currentUser) => {
  const isGestor = canViewAllNotes(currentUser);
  const currentUserId = String(currentUser.id || currentUser._id);

  // Filtro base
  const query = {
    schoolId,
    studentId
  };

  // Se não for gestor, só vê as notas que ele mesmo criou OU notas que não são privadas
  if (!isGestor) {
    query.$or = [
      { type: { $in: ['ATTENTION', 'WARNING'] } },
      { createdBy: currentUserId }
    ];
  }

  return StudentNote.find(query)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'fullName profilePictureUrl');
};

exports.deleteNote = async (schoolId, noteId, currentUser) => {
  const isGestor = canViewAllNotes(currentUser);
  const currentUserId = String(currentUser.id || currentUser._id);

  const note = await StudentNote.findOne({ _id: noteId, schoolId });
  
  if (!note) {
    throw new Error('Anotação não encontrada.');
  }

  // Apenas quem criou ou um gestor pode apagar a anotação
  if (!isGestor && String(note.createdBy) !== currentUserId) {
    throw new Error('Permissão negada. Apenas o criador da anotação ou a coordenação podem excluí-la.');
  }

  await StudentNote.deleteOne({ _id: noteId });
  return { success: true, message: 'Anotação removida com sucesso.' };
};