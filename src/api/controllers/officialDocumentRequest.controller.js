const officialDocumentRequestService = require('../services/officialDocumentRequest.service');
const {
  getStaffContext,
  getStudentContext,
  getGuardianContext,
  parseMaybeArray,
  sendError,
} = require('./officialDocument.controller.helpers');

const normalizeRequestBody = (body = {}) => ({
  ...body,
  targetGuardianIds: parseMaybeArray(body.targetGuardianIds),
});

class OfficialDocumentRequestController {
  async createSchool(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentRequestService.createSchoolRequest(
        normalizeRequestBody(req.body),
        context
      );

      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel criar a solicitacao de documento.');
    }
  }

  async createGuardian(req, res) {
    try {
      const context = getGuardianContext(req);
      const result = await officialDocumentRequestService.createGuardianRequest(
        normalizeRequestBody(req.body),
        context
      );

      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel criar a solicitacao do responsavel.');
    }
  }

  async createStudent(req, res) {
    try {
      const context = getStudentContext(req);
      const result = await officialDocumentRequestService.createStudentRequest(
        normalizeRequestBody(req.body),
        context
      );

      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel criar a solicitacao do aluno.');
    }
  }

  async listSchool(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentRequestService.listSchoolRequests(
        req.query,
        context.schoolId
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel listar as solicitacoes da escola.');
    }
  }

  async listGuardian(req, res) {
    try {
      const context = getGuardianContext(req);
      const result = await officialDocumentRequestService.listGuardianRequests(
        req.query,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel listar as solicitacoes do responsavel.');
    }
  }

  async listStudent(req, res) {
    try {
      const context = getStudentContext(req);
      const result = await officialDocumentRequestService.listStudentRequests(
        req.query,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel listar as solicitacoes do aluno.');
    }
  }

  async getSchoolById(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentRequestService.getSchoolRequestById(
        req.params.id,
        context.schoolId
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel carregar a solicitacao.');
    }
  }

  async getGuardianById(req, res) {
    try {
      const context = getGuardianContext(req);
      const result = await officialDocumentRequestService.getGuardianRequestById(
        req.params.id,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel carregar a solicitacao do responsavel.');
    }
  }

  async getStudentById(req, res) {
    try {
      const context = getStudentContext(req);
      const result = await officialDocumentRequestService.getStudentRequestById(
        req.params.id,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel carregar a solicitacao do aluno.');
    }
  }

  async approve(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentRequestService.approveRequest(
        req.params.id,
        req.body,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel aprovar a solicitacao.');
    }
  }

  async reject(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentRequestService.rejectRequest(
        req.params.id,
        req.body,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel rejeitar a solicitacao.');
    }
  }

  async cancelSchool(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentRequestService.cancelSchoolRequest(
        req.params.id,
        req.body,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel cancelar a solicitacao.');
    }
  }

  async cancelGuardian(req, res) {
    try {
      const guardianContext = getGuardianContext(req);
      const result = await officialDocumentRequestService.cancelOwnRequest(
        req.params.id,
        req.body,
        {
          ...guardianContext,
          actorType: 'guardian',
          actorId: guardianContext.tutorId,
        }
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel cancelar a solicitacao do responsavel.');
    }
  }

  async cancelStudent(req, res) {
    try {
      const studentContext = getStudentContext(req);
      const result = await officialDocumentRequestService.cancelOwnRequest(
        req.params.id,
        req.body,
        {
          ...studentContext,
          actorType: 'student',
          actorId: studentContext.studentId,
        }
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel cancelar a solicitacao do aluno.');
    }
  }

  async updateStatus(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentRequestService.updateSchoolRequestStatus(
        req.params.id,
        req.body,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel atualizar o status da solicitacao.');
    }
  }
}

module.exports = new OfficialDocumentRequestController();
