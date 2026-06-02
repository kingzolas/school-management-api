const jwt = require('jsonwebtoken');
const PlatformAdmin = require('../models/platformAdmin.model');
const { getPlatformJwtSecret } = require('../middlewares/platformAuth.middleware');

function serializeAdmin(admin) {
  return {
    id: String(admin._id),
    name: admin.name,
    email: admin.email,
    role: admin.role,
    isActive: admin.isActive,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

class PlatformAdminService {
  async login(email, password) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
      const error = new Error('E-mail e senha sao obrigatorios.');
      error.status = 400;
      throw error;
    }

    const admin = await PlatformAdmin.findOne({ email: normalizedEmail }).select('+passwordHash');
    if (!admin || admin.isActive === false) {
      const error = new Error('Credenciais invalidas.');
      error.status = 401;
      throw error;
    }

    const passwordMatches = await admin.comparePassword(password);
    if (!passwordMatches) {
      const error = new Error('Credenciais invalidas.');
      error.status = 401;
      throw error;
    }

    const secret = getPlatformJwtSecret();
    if (!secret) {
      const error = new Error('Configuracao JWT da plataforma ausente.');
      error.status = 500;
      throw error;
    }

    const payload = {
      id: String(admin._id),
      email: admin.email,
      role: admin.role,
      tokenType: 'platform_admin',
    };

    const token = jwt.sign(payload, secret, { expiresIn: '1d' });

    return {
      admin: serializeAdmin(admin),
      token,
    };
  }
}

module.exports = new PlatformAdminService();
