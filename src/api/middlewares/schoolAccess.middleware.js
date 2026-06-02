const School = require('../models/school.model');

async function verifySchoolAccess(req, res, next) {
  try {
    const schoolId = req.user?.school_id || req.user?.schoolId;

    if (!schoolId) {
      return res.status(403).json({ message: 'Contexto da escola nao encontrado.' });
    }

    const school = await School.findById(schoolId)
      .select('_id platformAccess')
      .lean();

    if (!school) {
      return res.status(404).json({ message: 'Escola nao encontrada.' });
    }

    const access = school.platformAccess || {};
    if (access.isBlocked || access.status === 'blocked') {
      return res.status(403).json({
        code: 'SCHOOL_BLOCKED',
        message: 'Acesso bloqueado. Entre em contato com o suporte do Academy Hub.',
      });
    }

    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao validar acesso da escola.' });
  }
}

module.exports = {
  verifySchoolAccess,
};
