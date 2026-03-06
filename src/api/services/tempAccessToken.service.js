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

    console.log('🔐 [TempToken] Criando token temporário...');
    console.log(`📌 [TempToken] schoolId=${schoolId}`);
    console.log(`📌 [TempToken] tutorId=${tutorId || 'N/A'}`);
    console.log(`📌 [TempToken] studentId=${studentId}`);
    console.log(`📌 [TempToken] requestedPhone=${requestedPhone || 'N/A'}`);
    console.log(`📌 [TempToken] rawToken=${rawToken}`);
    console.log(`📌 [TempToken] tokenHash=${tokenHash}`);
    console.log(`📌 [TempToken] expiresAt=${expiresAt.toISOString()}`);

    const created = await TempAccessToken.create({
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

    console.log(`✅ [TempToken] Token salvo com sucesso | id=${created._id}`);

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

    console.log('🔓 [TempToken] Consumindo token...');
    console.log(`📌 [TempToken] rawToken recebido=${rawToken}`);
    console.log(`📌 [TempToken] tokenHash calculado=${tokenHash}`);

    const tokenDoc = await TempAccessToken.findOne({
      token_hash: tokenHash,
      purpose: 'student_portal_access',
      status: 'active',
    });

    if (!tokenDoc) {
      console.warn('❌ [TempToken] Nenhum token ativo encontrado para este hash.');

      const tokenWithOtherStatus = await TempAccessToken.findOne({
        token_hash: tokenHash,
        purpose: 'student_portal_access',
      }).select('_id status expires_at used_at school_id student_id tutor_id createdAt');

      if (tokenWithOtherStatus) {
        console.warn('⚠️ [TempToken] Token encontrado com outro status:');
        console.warn({
          id: tokenWithOtherStatus._id,
          status: tokenWithOtherStatus.status,
          expires_at: tokenWithOtherStatus.expires_at,
          used_at: tokenWithOtherStatus.used_at,
          school_id: tokenWithOtherStatus.school_id,
          student_id: tokenWithOtherStatus.student_id,
          tutor_id: tokenWithOtherStatus.tutor_id,
          createdAt: tokenWithOtherStatus.createdAt,
        });
      } else {
        console.warn('⚠️ [TempToken] Nenhum documento encontrado nem com outro status.');
      }

      throw new Error('Token inválido ou já utilizado.');
    }

    console.log(`✅ [TempToken] Token encontrado | id=${tokenDoc._id} | status=${tokenDoc.status}`);
    console.log(`📌 [TempToken] expires_at=${tokenDoc.expires_at?.toISOString?.() || tokenDoc.expires_at}`);
    console.log(`📌 [TempToken] school_id=${tokenDoc.school_id}`);
    console.log(`📌 [TempToken] student_id=${tokenDoc.student_id}`);
    console.log(`📌 [TempToken] tutor_id=${tokenDoc.tutor_id || 'N/A'}`);

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