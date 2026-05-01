const enrollmentOfferService = require('../services/enrollmentOffer.service');

function getSchoolId(req) {
  const schoolId = req.user?.school_id || req.user?.schoolId;
  if (!schoolId) {
    const error = new Error('Usuario nao autenticado ou nao associado a uma escola.');
    error.statusCode = 403;
    throw error;
  }
  return schoolId;
}

function getUserId(req) {
  return req.user?.id || req.user?._id || null;
}

function sendError(res, error, fallbackMessage = 'Erro ao processar oferta.') {
  const statusCode = error.statusCode || (error.name === 'ValidationError' ? 400 : 500);
  return res.status(statusCode).json({
    message: error.message || fallbackMessage,
  });
}

class EnrollmentOfferController {
  async list(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const offers = await enrollmentOfferService.listOffers(req.query, schoolId);
      return res.json(offers);
    } catch (error) {
      console.error('Erro list enrollment offers:', error);
      return sendError(res, error, 'Erro ao listar ofertas.');
    }
  }

  async create(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const offer = await enrollmentOfferService.createOffer(
        req.body,
        schoolId,
        getUserId(req)
      );
      return res.status(201).json(offer);
    } catch (error) {
      console.error('Erro create enrollment offer:', error);
      return sendError(res, error, 'Erro ao criar oferta.');
    }
  }

  async getById(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const offer = await enrollmentOfferService.getOfferById(req.params.id, schoolId);
      return res.json(offer);
    } catch (error) {
      console.error('Erro get enrollment offer:', error);
      return sendError(res, error, 'Erro ao buscar oferta.');
    }
  }

  async update(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const offer = await enrollmentOfferService.updateOffer(
        req.params.id,
        req.body,
        schoolId,
        getUserId(req)
      );
      return res.json(offer);
    } catch (error) {
      console.error('Erro update enrollment offer:', error);
      return sendError(res, error, 'Erro ao atualizar oferta.');
    }
  }

  async updateStatus(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const offer = await enrollmentOfferService.updateStatus(
        req.params.id,
        req.body?.status,
        schoolId,
        getUserId(req)
      );
      return res.json(offer);
    } catch (error) {
      console.error('Erro update enrollment offer status:', error);
      return sendError(res, error, 'Erro ao alterar status da oferta.');
    }
  }
}

module.exports = new EnrollmentOfferController();
