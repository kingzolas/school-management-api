const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TempAccessToken = require('../models/temp-access-token.model');
const Student = require('../models/student.model');

class TempAccessTokenService {
  constructor() {
    this.ttlMinutes = 20;
  }

  _generateRawToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  _hashToken(rawToken) {
    return crypto
      .createHash('sha256')
      .update(String(rawToken))
      .digest('hex');
  }

  async createStudentPortalToken({ schoolId, tutorId = null, studentId, requestedPhone }) {
    const rawToken = this._generateRawToken();
    const tokenHash = this._hashToken(rawToken);

    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60 * 1000);

    await TempAccessToken.create({
      school_id: schoolId,
      tutor_id: tutorId,
      student_id: studentId,
      requested_phone: requestedPhone,
      token_hash: tokenHash,
      expires_at: expiresAt,
      status: 'active',
      purpose: 'student_portal_access',
      created_by: 'whatsapp_bot',
    });

    return {
      rawToken,
      expiresAt,
    };
  }

  async consumeStudentPortalToken(rawToken) {
    if (!rawToken) {
      throw new Error('Token de acesso não informado.');
    }

    const tokenHash = this._hashToken(rawToken);

    const tokenDoc = await TempAccessToken.findOne({
      token_hash: tokenHash,
      purpose: 'student_portal_access',
      status: 'active',
    });

    if (!tokenDoc) {
      throw new Error('Token inválido ou já utilizado.');
    }

    if (tokenDoc.expires_at.getTime() < Date.now()) {
      tokenDoc.status = 'expired';
      await tokenDoc.save();
      throw new Error('Token expirado. Solicite um novo acesso pelo WhatsApp.');
    }

    const student = await Student.findOne({
      _id: tokenDoc.student_id,
      school_id: tokenDoc.school_id,
    }).populate('school_id', 'name logoUrl');

    if (!student) {
      throw new Error('Aluno não encontrado para este token.');
    }

    tokenDoc.status = 'used';
    tokenDoc.used_at = new Date();
    await tokenDoc.save();

    const payload = {
      id: student._id,
      role: 'student',
      school_id: student.school_id._id,
      access_mode: 'magic_link',
    };

    const authToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '30m',
    });

    await Student.findByIdAndUpdate(student._id, {
      'accessCredentials.lastLogin': new Date(),
    });

    return {
      authToken,
      student: {
        id: student._id,
        fullName: student.fullName,
        enrollmentNumber: student.enrollmentNumber,
        profilePictureUrl: student.profilePictureUrl,
        role: 'student',
        school: {
          id: student.school_id._id,
          name: student.school_id.name,
        },
      },
    };
  }

  async revokeExpiredTokens() {
    return TempAccessToken.updateMany(
      {
        status: 'active',
        expires_at: { $lt: new Date() },
      },
      {
        $set: { status: 'expired' },
      }
    );
  }
}

module.exports = new TempAccessTokenService();