const jwt = require('jsonwebtoken');

const GuardianAccessAccount = require('../models/guardianAccessAccount.model');

const GUARDIAN_JWT_SECRET =
  process.env.GUARDIAN_JWT_SECRET || process.env.JWT_SECRET;

async function verifyGuardianToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(403).json({ message: 'Nenhum token fornecido.' });
  }

  if (!GUARDIAN_JWT_SECRET) {
    return res.status(500).json({ message: 'JWT de responsavel nao configurado.' });
  }

  try {
    const payload = jwt.verify(token, GUARDIAN_JWT_SECRET);

    if (
      payload?.principalType !== 'guardian' ||
      payload?.tokenType !== 'guardian_auth'
    ) {
      return res.status(401).json({ message: 'Token de responsavel invalido.' });
    }

    const account = await GuardianAccessAccount.findOne({
      _id: payload.accountId,
      school_id: payload.school_id,
      tutorId: payload.tutorId,
    }).select('identifierMasked status blockedUntil tokenVersion school_id tutorId');

    if (!account) {
      return res.status(401).json({ message: 'Conta de responsavel nao encontrada.' });
    }

    if (Number(account.tokenVersion || 0) !== Number(payload.tokenVersion || 0)) {
      return res.status(401).json({ message: 'Token de responsavel expirado.' });
    }

    if (account.status !== 'active') {
      return res.status(403).json({ message: 'Conta de responsavel indisponivel.' });
    }

    if (account.blockedUntil && new Date(account.blockedUntil) > new Date()) {
      return res.status(423).json({
        message: 'Conta de responsavel temporariamente bloqueada.',
      });
    }

    req.guardian = {
      accountId: String(account._id),
      tutorId: String(account.tutorId),
      school_id: String(account.school_id),
      schoolId: String(account.school_id),
      identifierMasked: account.identifierMasked,
    };

    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Token de responsavel invalido.' });
  }
}

module.exports = {
  verifyGuardianToken,
};
