const absenceJustificationService = require('../services/absenceJustification.service');
const appEmitter = require('../../loaders/eventEmitter');

function getSchoolId(req) {
  return req.user?.schoolId || req.user?.school_id || req.guardian?.schoolId || req.guardian?.school_id;
}

function getGuardianContext(req) {
  return {
    schoolId: req.guardian?.schoolId || req.guardian?.school_id,
    accountId: req.guardian?.accountId,
    tutorId: req.guardian?.tutorId,
  };
}

function sendError(res, error, fallbackMessage) {
  const statusCode = error.statusCode || (error.name === 'CastError' ? 400 : 500);
  return res.status(statusCode).json({
    code: error.code || null,
    message: error.message || fallbackMessage,
  });
}

function ensureManagerAccess(req) {
  const roles = [
    ...(Array.isArray(req.user?.roles) ? req.user.roles : []),
    req.user?.role,
    req.user?.profile,
    req.user?.userType,
  ]
    .map((role) => String(role || '').trim().toLowerCase())
    .filter(Boolean);

  if (!roles.some((role) => ['admin', 'coordenador', 'gestor', 'secretaria'].includes(role))) {
    const error = new Error('Somente perfis administrativos podem acessar solicitacoes de abono.');
    error.statusCode = 403;
    error.code = 'absence_request_manager_access_required';
    throw error;
  }
}

function emitAttendanceIfApplied(req, request) {
  if (!Array.isArray(request?.appliedAttendanceRefs) || request.appliedAttendanceRefs.length === 0) {
    return;
  }

  appEmitter.emit('attendance_updated', {
    classId: String(request.classId?._id || request.classId),
    school_id: getSchoolId(req),
  });
}

exports.createGuardian = async (req, res) => {
  try {
    const result = await absenceJustificationService.createGuardianRequest(
      req.body,
      req.files,
      getGuardianContext(req)
    );

    return res.status(201).json({
      message: 'Solicitacao de abono criada com sucesso.',
      data: result,
    });
  } catch (error) {
    console.error('Erro ao criar solicitacao de abono do responsavel:', error);
    return sendError(res, error, 'Nao foi possivel criar a solicitacao de abono.');
  }
};

exports.listGuardian = async (req, res) => {
  try {
    const result = await absenceJustificationService.listGuardianRequests(
      req.query,
      getGuardianContext(req)
    );
    return res.status(200).json(result);
  } catch (error) {
    console.error('Erro ao listar solicitacoes de abono do responsavel:', error);
    return sendError(res, error, 'Nao foi possivel listar as solicitacoes de abono.');
  }
};

exports.getGuardianById = async (req, res) => {
  try {
    const result = await absenceJustificationService.getGuardianRequestById(
      req.params.id,
      getGuardianContext(req)
    );
    return res.status(200).json(result);
  } catch (error) {
    console.error('Erro ao buscar solicitacao de abono do responsavel:', error);
    return sendError(res, error, 'Nao foi possivel carregar a solicitacao de abono.');
  }
};

exports.cancelGuardian = async (req, res) => {
  try {
    const result = await absenceJustificationService.cancelGuardianRequest(
      req.params.id,
      req.body,
      getGuardianContext(req)
    );
    return res.status(200).json({
      message: 'Solicitacao de abono cancelada com sucesso.',
      data: result,
    });
  } catch (error) {
    console.error('Erro ao cancelar solicitacao de abono:', error);
    return sendError(res, error, 'Nao foi possivel cancelar a solicitacao de abono.');
  }
};

exports.complementGuardian = async (req, res) => {
  try {
    const result = await absenceJustificationService.complementGuardianRequest(
      req.params.id,
      req.body,
      req.files,
      getGuardianContext(req)
    );
    return res.status(200).json({
      message: 'Complemento registrado com sucesso.',
      data: result,
    });
  } catch (error) {
    console.error('Erro ao complementar solicitacao de abono:', error);
    return sendError(res, error, 'Nao foi possivel complementar a solicitacao de abono.');
  }
};

exports.listSchool = async (req, res) => {
  try {
    ensureManagerAccess(req);
    const result = await absenceJustificationService.listSchoolRequests(
      getSchoolId(req),
      req.query
    );
    return res.status(200).json(result);
  } catch (error) {
    console.error('Erro ao listar solicitacoes de abono:', error);
    return sendError(res, error, 'Nao foi possivel listar as solicitacoes de abono.');
  }
};

exports.getSchoolById = async (req, res) => {
  try {
    ensureManagerAccess(req);
    const result = await absenceJustificationService.getSchoolRequestById(
      getSchoolId(req),
      req.params.id
    );
    return res.status(200).json(result);
  } catch (error) {
    console.error('Erro ao buscar solicitacao de abono:', error);
    return sendError(res, error, 'Nao foi possivel carregar a solicitacao de abono.');
  }
};

exports.downloadSchoolAttachment = async (req, res) => {
  try {
    ensureManagerAccess(req);
    const attachment = await absenceJustificationService.getRequestAttachment(
      getSchoolId(req),
      req.params.id,
      req.params.attachmentId
    );

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(attachment.fileName || 'anexo')}"`
    );

    return res.send(attachment.data);
  } catch (error) {
    console.error('Erro ao baixar anexo da solicitacao de abono:', error);
    return sendError(res, error, 'Nao foi possivel baixar o anexo.');
  }
};

exports.downloadGuardianAttachment = async (req, res) => {
  try {
    const context = getGuardianContext(req);
    await absenceJustificationService.getGuardianRequestById(req.params.id, context);
    const attachment = await absenceJustificationService.getRequestAttachment(
      context.schoolId,
      req.params.id,
      req.params.attachmentId,
      { guardianId: context.tutorId }
    );

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(attachment.fileName || 'anexo')}"`
    );

    return res.send(attachment.data);
  } catch (error) {
    console.error('Erro ao baixar anexo da solicitacao de abono do responsavel:', error);
    return sendError(res, error, 'Nao foi possivel baixar o anexo.');
  }
};

exports.approve = async (req, res) => {
  try {
    ensureManagerAccess(req);
    const result = await absenceJustificationService.approveRequest(
      getSchoolId(req),
      req.params.id,
      req.body,
      req.user
    );
    emitAttendanceIfApplied(req, result);
    return res.status(200).json({
      message: 'Solicitacao de abono aprovada com sucesso.',
      data: result,
    });
  } catch (error) {
    console.error('Erro ao aprovar solicitacao de abono:', error);
    return sendError(res, error, 'Nao foi possivel aprovar a solicitacao de abono.');
  }
};

exports.partialApprove = async (req, res) => {
  try {
    ensureManagerAccess(req);
    const result = await absenceJustificationService.partialApproveRequest(
      getSchoolId(req),
      req.params.id,
      req.body,
      req.user
    );
    emitAttendanceIfApplied(req, result);
    return res.status(200).json({
      message: 'Solicitacao de abono aprovada parcialmente.',
      data: result,
    });
  } catch (error) {
    console.error('Erro ao aprovar parcialmente solicitacao de abono:', error);
    return sendError(res, error, 'Nao foi possivel aprovar parcialmente a solicitacao de abono.');
  }
};

exports.reject = async (req, res) => {
  try {
    ensureManagerAccess(req);
    const result = await absenceJustificationService.rejectRequest(
      getSchoolId(req),
      req.params.id,
      req.body,
      req.user
    );
    return res.status(200).json({
      message: 'Solicitacao de abono recusada com sucesso.',
      data: result,
    });
  } catch (error) {
    console.error('Erro ao recusar solicitacao de abono:', error);
    return sendError(res, error, 'Nao foi possivel recusar a solicitacao de abono.');
  }
};

exports.requestInfo = async (req, res) => {
  try {
    ensureManagerAccess(req);
    const result = await absenceJustificationService.requestMoreInfo(
      getSchoolId(req),
      req.params.id,
      req.body,
      req.user
    );
    return res.status(200).json({
      message: 'Solicitacao de complemento registrada com sucesso.',
      data: result,
    });
  } catch (error) {
    console.error('Erro ao solicitar complemento de abono:', error);
    return sendError(res, error, 'Nao foi possivel solicitar complemento.');
  }
};
