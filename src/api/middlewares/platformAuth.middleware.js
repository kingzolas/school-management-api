const jwt = require('jsonwebtoken');
const PlatformAdmin = require('../models/platformAdmin.model');

function getPlatformJwtSecret() {
  return process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET;
}

async function verifyPlatformToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(403).json({ message: 'Nenhum token platform fornecido.' });
    }

    const secret = getPlatformJwtSecret();
    if (!secret) {
      return res.status(500).json({ message: 'Configuracao JWT da plataforma ausente.' });
    }

    const payload = jwt.verify(token, secret);
    if (payload?.tokenType !== 'platform_admin') {
      return res.status(401).json({ message: 'Token nao autorizado neste fluxo.' });
    }

    const admin = await PlatformAdmin.findById(payload.id)
      .select('_id name email role isActive')
      .lean();

    if (!admin || admin.isActive === false) {
      return res.status(401).json({ message: 'Administrador da plataforma invalido ou inativo.' });
    }

    req.platformAdmin = {
      id: String(admin._id),
      name: admin.name,
      email: admin.email,
      role: admin.role,
    };

    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Token platform invalido ou expirado.' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (req.platformAdmin?.role !== 'superAdmin') {
    return res.status(403).json({ message: 'Acesso restrito a superAdmin.' });
  }

  return next();
}

module.exports = {
  verifyPlatformToken,
  requireSuperAdmin,
  getPlatformJwtSecret,
};
