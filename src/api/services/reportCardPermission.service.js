function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function extractId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
}

function getActorId(actor = {}) {
  return extractId(actor._id || actor.id || actor.userId || actor.user_id);
}

function getActorSchoolId(actor = {}) {
  return extractId(actor.school_id || actor.schoolId);
}

function getActorRoles(actor = {}) {
  const roles = [];

  if (Array.isArray(actor.roles)) roles.push(...actor.roles);
  if (actor.role) roles.push(actor.role);
  if (actor.type) roles.push(actor.type);
  if (actor.perfil) roles.push(actor.perfil);
  if (actor.profile) roles.push(actor.profile);
  if (actor.userType) roles.push(actor.userType);

  return roles.map(normalizeText).filter(Boolean);
}

function isReportCardPrivilegedReviewer(actor = {}) {
  const roles = getActorRoles(actor);

  return roles.some((role) =>
    [
      'ADMIN',
      'COORDENADOR',
      'COORDENACAO',
      'COORDINATOR',
    ].includes(role)
  );
}

function isProfessor(actor = {}) {
  return getActorRoles(actor).includes('PROFESSOR');
}

function isTeacherLinkedToSubject(actor = {}, subjectItem = {}) {
  const actorId = getActorId(actor);
  const teacherId = extractId(subjectItem.teacherId);

  return Boolean(actorId && teacherId && actorId === teacherId);
}

function getPrimaryReportCardEditRole(actor = {}) {
  const roles = getActorRoles(actor);

  if (roles.includes('ADMIN')) return 'Admin';
  if (
    roles.includes('COORDENADOR') ||
    roles.includes('COORDENACAO') ||
    roles.includes('COORDINATOR')
  ) {
    return 'Coordenador';
  }
  if (roles.includes('PROFESSOR')) return 'Professor';

  return roles[0] || 'Indefinido';
}

function canEditReportCardSubject({ actor, reportCard, subjectItem }) {
  const actorSchoolId = getActorSchoolId(actor);
  const reportCardSchoolId = extractId(reportCard?.school_id);

  if (!actorSchoolId || !reportCardSchoolId || actorSchoolId !== reportCardSchoolId) {
    return {
      allowed: false,
      reason: 'school_mismatch',
      message: 'Usuário não pertence à escola deste boletim.',
    };
  }

  if (isReportCardPrivilegedReviewer(actor)) {
    return {
      allowed: true,
      reason: 'privileged_reviewer',
      role: getPrimaryReportCardEditRole(actor),
    };
  }

  if (isProfessor(actor) && isTeacherLinkedToSubject(actor, subjectItem)) {
    return {
      allowed: true,
      reason: 'linked_teacher',
      role: 'Professor',
    };
  }

  return {
    allowed: false,
    reason: 'not_allowed',
    message: 'Você não tem permissão para editar esta disciplina neste boletim.',
  };
}

module.exports = {
  extractId,
  getActorId,
  getActorSchoolId,
  getActorRoles,
  getPrimaryReportCardEditRole,
  isReportCardPrivilegedReviewer,
  isProfessor,
  isTeacherLinkedToSubject,
  canEditReportCardSubject,
};
