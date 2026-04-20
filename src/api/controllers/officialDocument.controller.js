const officialDocumentService = require('../services/officialDocument.service');
const {
  getStaffContext,
  getStudentContext,
  getGuardianContext,
  parseMaybeArray,
  sendError,
} = require('./officialDocument.controller.helpers');

const normalizeDocumentBody = (body = {}) => ({
  ...body,
  guardianIds: parseMaybeArray(body.guardianIds),
});

const setPdfHeaders = (res, file = {}) => {
  res.setHeader('Content-Type', file.mimeType || 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(file.fileName || 'documento-assinado.pdf')}"`
  );
};

class OfficialDocumentController {
  async uploadSigned(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentService.registerSignedDocument(
        normalizeDocumentBody(req.body),
        req.file,
        context
      );

      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel registrar o documento assinado.');
    }
  }

  async listSchool(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentService.listSchoolDocuments(
        req.query,
        context.schoolId
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel listar os documentos da escola.');
    }
  }

  async listGuardian(req, res) {
    try {
      const context = getGuardianContext(req);
      const result = await officialDocumentService.listGuardianDocuments(
        req.query,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel listar os documentos do responsavel.');
    }
  }

  async listStudent(req, res) {
    try {
      const context = getStudentContext(req);
      const result = await officialDocumentService.listStudentDocuments(
        req.query,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel listar os documentos do aluno.');
    }
  }

  async getSchoolById(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentService.getSchoolDocumentById(
        req.params.id,
        context.schoolId
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel carregar o documento.');
    }
  }

  async getGuardianById(req, res) {
    try {
      const context = getGuardianContext(req);
      const result = await officialDocumentService.getGuardianDocumentById(
        req.params.id,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel carregar o documento do responsavel.');
    }
  }

  async getStudentById(req, res) {
    try {
      const context = getStudentContext(req);
      const result = await officialDocumentService.getStudentDocumentById(
        req.params.id,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel carregar o documento do aluno.');
    }
  }

  async publish(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentService.publishDocument(
        req.params.id,
        req.body,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel publicar o documento.');
    }
  }

  async updateVisibility(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentService.updateVisibility(
        req.params.id,
        req.body,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel atualizar a visibilidade do documento.');
    }
  }

  async replace(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentService.replaceDocument(
        req.params.id,
        normalizeDocumentBody(req.body),
        req.file,
        context
      );

      return res.status(201).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel substituir o documento por nova versao.');
    }
  }

  async recordSchoolDownload(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentService.recordSchoolDownload(
        req.params.id,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel registrar o download do documento.');
    }
  }

  async recordGuardianDownload(req, res) {
    try {
      const context = getGuardianContext(req);
      const result = await officialDocumentService.recordGuardianDownload(
        req.params.id,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel registrar o download do responsavel.');
    }
  }

  async recordStudentDownload(req, res) {
    try {
      const context = getStudentContext(req);
      const result = await officialDocumentService.recordStudentDownload(
        req.params.id,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel registrar o download do aluno.');
    }
  }

  async downloadSchoolFile(req, res) {
    try {
      const context = getStaffContext(req);
      const file = await officialDocumentService.downloadSchoolDocumentFile(
        req.params.id,
        context
      );

      setPdfHeaders(res, file);
      return res.send(file.data);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel baixar o documento.');
    }
  }

  async downloadGuardianFile(req, res) {
    try {
      const context = getGuardianContext(req);
      const file = await officialDocumentService.downloadGuardianDocumentFile(
        req.params.id,
        context
      );

      setPdfHeaders(res, file);
      return res.send(file.data);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel baixar o documento do responsavel.');
    }
  }

  async downloadStudentFile(req, res) {
    try {
      const context = getStudentContext(req);
      const file = await officialDocumentService.downloadStudentDocumentFile(
        req.params.id,
        context
      );

      setPdfHeaders(res, file);
      return res.send(file.data);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel baixar o documento do aluno.');
    }
  }

  async cancel(req, res) {
    try {
      const context = getStaffContext(req);
      const result = await officialDocumentService.cancelDocument(
        req.params.id,
        req.body,
        context
      );

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Nao foi possivel cancelar o documento.');
    }
  }
}

module.exports = new OfficialDocumentController();
