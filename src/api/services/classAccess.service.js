const mongoose = require('mongoose');

const Class = require('../models/class.model');
const Enrollment = require('../models/enrollment.model');
const Horario = require('../models/horario.model');

const PRIVILEGED_ROLES = new Set([
  'ADMIN',
  'ADMINISTRADOR',
  'COORDENADOR',
  'DIRETOR',
  'GESTOR',
]);

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function extractId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];

  return roles
    .map((role) => String(role || '').trim().toUpperCase())
    .filter(Boolean);
}

function getActorRoles(actor = {}) {
  const roles = [];

  if (Array.isArray(actor.roles)) roles.push(...actor.roles);
  if (actor.role) roles.push(actor.role);
  if (actor.profile) roles.push(actor.profile);
  if (actor.userType) roles.push(actor.userType);

  return normalizeRoles(roles);
}

function isPrivilegedActor(actor) {
  return getActorRoles(actor).some((role) => PRIVILEGED_ROLES.has(role));
}

async function ensureClassAccess(actor, schoolId, classId) {
  if (!classId) {
    throw createHttpError('ID da turma e obrigatorio.', 400);
  }

  if (!mongoose.Types.ObjectId.isValid(classId)) {
    throw createHttpError('Turma invalida.', 400);
  }

  const classDoc = await Class.findOne({
    _id: classId,
    school_id: schoolId,
  }).select('_id name grade shift schoolYear school_id');

  if (!classDoc) {
    throw createHttpError(
      'Turma nao encontrada ou nao pertence a sua escola.',
      404
    );
  }

  if (isPrivilegedActor(actor)) {
    return classDoc;
  }

  const teacherId = extractId(actor?.id || actor?._id);
  if (!teacherId) {
    throw createHttpError('Acesso negado a esta turma.', 403);
  }

  const access = await Horario.exists({
    school_id: schoolId,
    classId: classDoc._id,
    teacherId,
  });

  if (!access) {
    throw createHttpError(
      'Turma nao encontrada ou nao pertence a sua escola.',
      404
    );
  }

  return classDoc;
}

async function getAccessibleClassIds(actor, schoolId) {
  if (isPrivilegedActor(actor)) {
    return null;
  }

  const teacherId = extractId(actor?.id || actor?._id);
  if (!teacherId) {
    throw createHttpError('Acesso negado a esta turma.', 403);
  }

  const schedules = await Horario.find({
    school_id: schoolId,
    teacherId,
  })
    .select('classId')
    .lean();

  return [
    ...new Set(
      schedules
        .map((item) => extractId(item.classId))
        .filter(Boolean)
    ),
  ];
}

async function ensureStudentEnrollmentAccess({
  actor,
  schoolId,
  classId,
  studentId,
  allowedStatuses = ['Ativa'],
}) {
  const classDoc = await ensureClassAccess(actor, schoolId, classId);

  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    throw createHttpError('Aluno invalido.', 400);
  }

  const query = {
    school_id: schoolId,
    class: classDoc._id,
    student: studentId,
  };

  if (Array.isArray(allowedStatuses) && allowedStatuses.length > 0) {
    query.status = { $in: allowedStatuses };
  }

  const enrollment = await Enrollment.findOne(query).select(
    '_id student class status academicYear enrollmentDate'
  );

  if (!enrollment) {
    throw createHttpError('Aluno nao encontrado na turma informada.', 404);
  }

  return { classDoc, enrollment };
}

async function ensureStudentAccessInAnyOwnedClass({
  actor,
  schoolId,
  studentId,
  allowedStatuses = ['Ativa'],
}) {
  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    throw createHttpError('Aluno invalido.', 400);
  }

  const query = {
    school_id: schoolId,
    student: studentId,
  };

  if (Array.isArray(allowedStatuses) && allowedStatuses.length > 0) {
    query.status = { $in: allowedStatuses };
  }

  if (!isPrivilegedActor(actor)) {
    const classIds = await getAccessibleClassIds(actor, schoolId);
    if (!Array.isArray(classIds) || classIds.length === 0) {
      throw createHttpError('Aluno nao encontrado nas suas turmas.', 404);
    }

    query.class = { $in: classIds };
  }

  const enrollment = await Enrollment.findOne(query)
    .select('_id student class status academicYear enrollmentDate')
    .sort({ enrollmentDate: -1, createdAt: -1 });

  if (!enrollment) {
    throw createHttpError('Aluno nao encontrado nas suas turmas.', 404);
  }

  return { enrollment };
}

module.exports = {
  PRIVILEGED_ROLES,
  createHttpError,
  extractId,
  normalizeRoles,
  isPrivilegedActor,
  getAccessibleClassIds,
  ensureClassAccess,
  ensureStudentEnrollmentAccess,
  ensureStudentAccessInAnyOwnedClass,
};
