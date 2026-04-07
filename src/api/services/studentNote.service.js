const StudentNote = require('../models/studentNote.model');
const { ensureStudentAccessInAnyOwnedClass } = require('./classAccess.service');

function canViewAllNotes(user = {}) {
  const roles = [];
  if (Array.isArray(user.roles)) roles.push(...user.roles);
  if (user.role) roles.push(user.role);
  if (user.profile) roles.push(user.profile);

  const userRoles = roles.map((role) => String(role || '').trim().toLowerCase());
  return userRoles.some((role) =>
    ['admin', 'coordenador', 'gestor', 'secretaria'].includes(role)
  );
}

function getCurrentUserId(currentUser = {}) {
  return String(currentUser.id || currentUser._id || '');
}

function applyOptionalLimit(query, limit) {
  const normalizedLimit = Number(limit);
  if (Number.isFinite(normalizedLimit) && normalizedLimit > 0) {
    query.limit(Math.min(normalizedLimit, 50));
  }

  return query;
}

async function createNote(data, currentUser) {
  const { schoolId, studentId, createdBy, type, title, description } = data;

  if (!schoolId || !studentId || !createdBy || !title || !description) {
    throw new Error(
      'Parametros obrigatorios ausentes (schoolId, studentId, createdBy, title, description).'
    );
  }

  await ensureStudentAccessInAnyOwnedClass({
    actor: currentUser,
    schoolId,
    studentId,
    allowedStatuses: ['Ativa'],
  });

  const note = await StudentNote.create({
    schoolId,
    studentId,
    createdBy,
    type: type || 'PRIVATE',
    title,
    description,
  });

  return StudentNote.findById(note._id)
    .populate('createdBy', 'fullName profilePictureUrl')
    .populate('studentId', 'fullName enrollmentNumber')
    .exec();
}

async function listStudentNotes(schoolId, studentId, currentUser, options = {}) {
  const isGestor = canViewAllNotes(currentUser);
  const currentUserId = getCurrentUserId(currentUser);

  await ensureStudentAccessInAnyOwnedClass({
    actor: currentUser,
    schoolId,
    studentId,
    allowedStatuses: ['Ativa'],
  });

  const query = {
    schoolId,
    studentId,
  };

  if (!isGestor) {
    query.$or = [
      { type: { $in: ['ATTENTION', 'WARNING'] } },
      { createdBy: currentUserId },
    ];
  }

  const notesQuery = StudentNote.find(query)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'fullName profilePictureUrl');

  applyOptionalLimit(notesQuery, options.limit);

  return notesQuery.exec();
}

async function deleteNote(schoolId, noteId, currentUser) {
  const isGestor = canViewAllNotes(currentUser);
  const currentUserId = getCurrentUserId(currentUser);

  const note = await StudentNote.findOne({ _id: noteId, schoolId });

  if (!note) {
    throw new Error('Anotacao nao encontrada.');
  }

  await ensureStudentAccessInAnyOwnedClass({
    actor: currentUser,
    schoolId,
    studentId: note.studentId,
    allowedStatuses: ['Ativa'],
  });

  if (!isGestor && String(note.createdBy) !== currentUserId) {
    throw new Error(
      'Permissao negada. Apenas o criador da anotacao ou a coordenacao podem exclui-la.'
    );
  }

  await StudentNote.deleteOne({ _id: noteId });
  return { success: true, message: 'Anotacao removida com sucesso.' };
}

module.exports = {
  createNote,
  listStudentNotes,
  deleteNote,
};
