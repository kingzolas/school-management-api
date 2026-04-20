const { createHttpError } = require('../validators/officialDocument.validator');

const getSchoolIdFromRequest = (req) => (
  req.user?.school_id
  || req.user?.schoolId
  || req.guardian?.school_id
  || req.guardian?.schoolId
  || null
);

const getActorIdFromUser = (user = {}) => user?.id || user?._id || null;

const getStaffContext = (req) => {
  if (!req.user || req.user.role === 'student') {
    throw createHttpError('Apenas usuarios internos da escola podem executar esta operacao.', 403, {
      code: 'staff_access_required',
    });
  }

  const schoolId = getSchoolIdFromRequest(req);
  const actorId = getActorIdFromUser(req.user);

  if (!schoolId || !actorId) {
    throw createHttpError('Contexto da escola nao encontrado no token autenticado.', 403, {
      code: 'school_context_required',
    });
  }

  return { schoolId, actorId };
};

const getStudentContext = (req) => {
  if (!req.user || req.user.role !== 'student') {
    throw createHttpError('Apenas alunos autenticados podem executar esta operacao.', 403, {
      code: 'student_access_required',
    });
  }

  const schoolId = getSchoolIdFromRequest(req);
  const studentId = req.user.studentId || req.user.id || req.user._id || null;

  if (!schoolId || !studentId) {
    throw createHttpError('Contexto do aluno nao encontrado no token autenticado.', 403, {
      code: 'student_context_required',
    });
  }

  return { schoolId, studentId };
};

const getGuardianContext = (req) => {
  if (!req.guardian?.school_id || !req.guardian?.accountId || !req.guardian?.tutorId) {
    throw createHttpError('Apenas responsaveis autenticados podem executar esta operacao.', 403, {
      code: 'guardian_access_required',
    });
  }

  return {
    schoolId: req.guardian.school_id,
    accountId: req.guardian.accountId,
    tutorId: req.guardian.tutorId,
  };
};

const parseMaybeJson = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === 'null' || trimmed === 'undefined') {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return value;
  }
};

const parseMaybeArray = (value) => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = parseMaybeJson(value);
  if (parsed === null) {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  return [parsed];
};

const sendError = (res, error, fallbackMessage) => res.status(error.statusCode || 500).json({
  code: error.code || null,
  message: error.message || fallbackMessage,
});

module.exports = {
  getSchoolIdFromRequest,
  getStaffContext,
  getStudentContext,
  getGuardianContext,
  parseMaybeJson,
  parseMaybeArray,
  sendError,
};
