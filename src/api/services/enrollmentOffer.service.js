const mongoose = require('mongoose');

const EnrollmentOffer = require('../models/enrollmentOffer.model');
const Class = require('../models/class.model');
const School = require('../models/school.model');
const { normalizeOfferName } = require('../models/enrollmentOffer.model');

const REGIME_TYPES = [
  'regular',
  'full_time',
  'extended_stay',
  'complementary_activity',
  'reinforcement',
  'other',
];

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ''));
}

function sameId(a, b) {
  return String(a || '') === String(b || '');
}

function parseBooleanFilter(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return String(value).trim().toLowerCase() === 'true';
}

function compactStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeObjectIdArray(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const normalized = [];

  value.forEach((item) => {
    const id = String(item || '').trim();
    if (!id || seen.has(id)) return;
    if (!isObjectId(id)) {
      throw createHttpError('Uma das turmas informadas e invalida.', 400);
    }
    seen.add(id);
    normalized.push(id);
  });

  return normalized;
}

function buildOfferSnapshot(offer) {
  if (!offer) return undefined;

  return {
    name: offer.name,
    type: offer.type,
    startTime: offer.startTime || null,
    endTime: offer.endTime || null,
    monthlyFee: offer.monthlyFee,
    pricingMode: offer.pricingMode,
    permanenceClassMode: offer.permanenceClassMode || 'none',
  };
}

function buildPublicOfferPayload(offer) {
  return {
    id: String(offer._id),
    name: offer.name,
    type: offer.type,
    description: offer.description || '',
    startTime: offer.startTime || null,
    endTime: offer.endTime || null,
    monthlyFee: offer.monthlyFee,
    pricingMode: offer.pricingMode,
    permanenceClassMode: offer.permanenceClassMode,
  };
}

function calculateAgreedFee(classDoc, offer) {
  if (!offer) return classDoc.monthlyFee;

  if (offer.pricingMode === 'additional') {
    return Number(classDoc.monthlyFee || 0) + Number(offer.monthlyFee || 0);
  }

  return Number(offer.monthlyFee || 0);
}

function resolveRegimeFromOffer(offer) {
  if (!offer) return 'regular';
  return REGIME_TYPES.includes(offer.type) ? offer.type : 'other';
}

function buildPermanenceClassSnapshot(classDoc) {
  if (!classDoc) return undefined;

  return {
    name: classDoc.name,
    shift: classDoc.shift || null,
    startTime: classDoc.scheduleSettings?.defaultStartTime || null,
    endTime: null,
  };
}

class EnrollmentOfferService {
  async _assertSchoolExists(schoolId) {
    if (!schoolId || !isObjectId(schoolId)) {
      throw createHttpError('Escola nao encontrada.', 404);
    }

    const school = await School.findById(schoolId).select('_id');
    if (!school) {
      throw createHttpError('Escola nao encontrada.', 404);
    }

    return school;
  }

  async _getClassOrThrow(classId, schoolId, message = 'Turma nao encontrada.') {
    if (!classId || !isObjectId(classId)) {
      throw createHttpError(message, 404);
    }

    const classDoc = await Class.findOne({ _id: classId, school_id: schoolId });
    if (!classDoc) {
      throw createHttpError(message, 404);
    }

    return classDoc;
  }

  async _validateApplicableClassIds(classIds, schoolId) {
    if (!Array.isArray(classIds) || classIds.length === 0) return [];

    const classes = await Class.find({
      _id: { $in: classIds },
      school_id: schoolId,
    }).select('_id');

    if (classes.length !== classIds.length) {
      throw createHttpError('Uma ou mais turmas informadas nao pertencem a esta escola.', 400);
    }

    return classIds;
  }

  async _normalizePayload(data = {}, schoolId, existingOffer = null) {
    const payload = { ...data };

    delete payload.school_id;
    delete payload.nameNormalized;
    delete payload.createdAt;
    delete payload.updatedAt;

    if (payload.name !== undefined) payload.name = String(payload.name || '').trim();
    if (payload.description !== undefined) {
      payload.description = String(payload.description || '').trim();
    }

    if (payload.applicableEducationLevels !== undefined) {
      payload.applicableEducationLevels = compactStringArray(payload.applicableEducationLevels);
    }

    if (payload.applicableClassIds !== undefined) {
      payload.applicableClassIds = normalizeObjectIdArray(payload.applicableClassIds);
    }

    const next = {
      ...(existingOffer ? existingOffer.toObject() : {}),
      ...payload,
    };

    if (next.appliesToAllClasses === undefined) {
      next.appliesToAllClasses = true;
      if (!existingOffer) payload.appliesToAllClasses = true;
    }

    if (next.appliesToAllClasses === true) {
      payload.applicableClassIds = [];
      next.applicableClassIds = [];
    }

    if (next.appliesToAllClasses === false) {
      const classIds = normalizeObjectIdArray(next.applicableClassIds);
      if (classIds.length === 0) {
        throw createHttpError('Informe ao menos uma turma para esta oferta.', 400);
      }
      await this._validateApplicableClassIds(classIds, schoolId);
      payload.applicableClassIds = classIds;
      next.applicableClassIds = classIds;
    }

    return { payload, next };
  }

  async _assertNoActiveDuplicateName({ schoolId, name, excludeId = null }) {
    const nameNormalized = normalizeOfferName(name);
    const query = {
      school_id: schoolId,
      nameNormalized,
      status: 'active',
    };

    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const existing = await EnrollmentOffer.findOne(query).select('_id name');
    if (existing) {
      throw createHttpError('Ja existe uma oferta ativa com esse nome nesta escola.', 409);
    }
  }

  isOfferApplicableToClass(offer, classDoc) {
    if (!offer || !classDoc) return false;

    const levels = Array.isArray(offer.applicableEducationLevels)
      ? offer.applicableEducationLevels.filter(Boolean)
      : [];

    if (levels.length > 0 && !levels.includes(classDoc.level)) {
      return false;
    }

    if (offer.appliesToAllClasses !== false) {
      return true;
    }

    return (offer.applicableClassIds || []).some((classId) =>
      sameId(classId, classDoc._id)
    );
  }

  async createOffer(data, schoolId, userId = null) {
    await this._assertSchoolExists(schoolId);

    const { payload, next } = await this._normalizePayload(data, schoolId);
    if (next.status !== 'inactive') {
      await this._assertNoActiveDuplicateName({ schoolId, name: next.name });
    }

    const offer = new EnrollmentOffer({
      ...payload,
      school_id: schoolId,
      createdBy: userId,
      updatedBy: userId,
    });

    try {
      return await offer.save();
    } catch (error) {
      if (error.code === 11000) {
        throw createHttpError('Ja existe uma oferta ativa com esse nome nesta escola.', 409);
      }
      throw error;
    }
  }

  async listOffers(filters = {}, schoolId) {
    const query = { school_id: schoolId };

    if (filters.status) query.status = filters.status;
    if (filters.type) query.type = filters.type;

    const publicVisible = parseBooleanFilter(filters.publicVisible);
    if (publicVisible !== undefined) {
      query.publicVisible = publicVisible;
    }

    return EnrollmentOffer.find(query).sort({ createdAt: -1, name: 1 });
  }

  async getOfferById(id, schoolId) {
    if (!isObjectId(id)) {
      throw createHttpError('Oferta invalida.', 400);
    }

    const offer = await EnrollmentOffer.findOne({ _id: id, school_id: schoolId });
    if (!offer) {
      throw createHttpError('Oferta nao encontrada nesta escola.', 404);
    }

    return offer;
  }

  async updateOffer(id, data, schoolId, userId = null) {
    const offer = await this.getOfferById(id, schoolId);
    const { payload, next } = await this._normalizePayload(data, schoolId, offer);

    if (next.status === 'active') {
      await this._assertNoActiveDuplicateName({
        schoolId,
        name: next.name,
        excludeId: offer._id,
      });
    }

    Object.assign(offer, payload, { updatedBy: userId });

    try {
      return await offer.save();
    } catch (error) {
      if (error.code === 11000) {
        throw createHttpError('Ja existe uma oferta ativa com esse nome nesta escola.', 409);
      }
      throw error;
    }
  }

  async updateStatus(id, status, schoolId, userId = null) {
    if (!['active', 'inactive'].includes(status)) {
      throw createHttpError('Status da oferta invalido.', 400);
    }

    const offer = await this.getOfferById(id, schoolId);
    if (status === 'active') {
      await this._assertNoActiveDuplicateName({
        schoolId,
        name: offer.name,
        excludeId: offer._id,
      });
    }

    offer.status = status;
    offer.updatedBy = userId;
    return offer.save();
  }

  async listPublicOffers(schoolId, classId = null) {
    await this._assertSchoolExists(schoolId);

    let classDoc = null;
    if (classId) {
      classDoc = await this._getClassOrThrow(
        classId,
        schoolId,
        'Turma nao encontrada para esta escola.'
      );
    }

    const offers = await EnrollmentOffer.find({
      school_id: schoolId,
      status: 'active',
      publicVisible: true,
    }).sort({ monthlyFee: 1, name: 1 });

    return offers
      .filter((offer) => !classDoc || this.isOfferApplicableToClass(offer, classDoc))
      .map(buildPublicOfferPayload);
  }

  async getApplicableOfferOrThrow({
    offerId,
    schoolId,
    classId,
    publicOnly = false,
  }) {
    if (!offerId) return null;

    if (!isObjectId(offerId)) {
      throw createHttpError('Oferta selecionada nao encontrada.', 404);
    }

    const offer = await EnrollmentOffer.findOne({ _id: offerId, school_id: schoolId });
    if (!offer) {
      throw createHttpError('Oferta selecionada nao encontrada.', 404);
    }

    if (offer.status !== 'active') {
      throw createHttpError('A oferta selecionada nao esta mais disponivel para esta turma.', 409);
    }

    if (publicOnly && offer.publicVisible !== true) {
      throw createHttpError('A oferta selecionada nao esta disponivel para solicitacoes publicas.', 409);
    }

    const classDoc = await this._getClassOrThrow(
      classId,
      schoolId,
      'Turma principal nao encontrada para validar a oferta.'
    );

    if (!this.isOfferApplicableToClass(offer, classDoc)) {
      throw createHttpError('A oferta selecionada nao esta mais disponivel para esta turma.', 409);
    }

    return {
      offer,
      classDoc,
      snapshot: buildOfferSnapshot(offer),
      requestedRegime: resolveRegimeFromOffer(offer),
    };
  }

  async getPermanenceClassOrThrow(classId, schoolId) {
    if (!classId) return null;
    const classDoc = await this._getClassOrThrow(classId, schoolId, 'Turma de permanencia nao encontrada nesta escola.');
    const status = String(classDoc.status || '').trim().toLowerCase();
    if (status && status !== 'ativa' && status !== 'active') {
      throw createHttpError('A turma de permanencia selecionada nao esta ativa.', 400);
    }
    return classDoc;
  }
}

module.exports = new EnrollmentOfferService();
module.exports.buildOfferSnapshot = buildOfferSnapshot;
module.exports.buildPermanenceClassSnapshot = buildPermanenceClassSnapshot;
module.exports.calculateAgreedFee = calculateAgreedFee;
module.exports.resolveRegimeFromOffer = resolveRegimeFromOffer;
module.exports.REGIME_TYPES = REGIME_TYPES;
