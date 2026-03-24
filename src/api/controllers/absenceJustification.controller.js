const absenceJustificationService = require('../services/absenceJustification.service');
const appEmitter = require('../../loaders/eventEmitter');

exports.create = async (req, res) => {
  try {
    const result = await absenceJustificationService.create(
      {
        ...req.body,
        schoolId: req.user.schoolId
      },
      req.file,
      req.user
    );

    appEmitter.emit('attendance_updated', {
      classId: req.body.classId,
      school_id: req.user.schoolId
    });

    return res.status(201).json({
      message: 'Justificativa criada com sucesso.',
      data: result
    });
  } catch (error) {
    console.error('Erro ao criar justificativa:', error);
    return res.status(400).json({ message: error.message || 'Erro ao criar justificativa.' });
  }
};

exports.list = async (req, res) => {
  try {
    const result = await absenceJustificationService.list(req.user.schoolId, req.query);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Erro ao listar justificativas:', error);
    return res.status(500).json({ message: 'Erro ao listar justificativas.' });
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await absenceJustificationService.getById(req.user.schoolId, req.params.id);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Erro ao buscar justificativa:', error);
    return res.status(404).json({ message: error.message || 'Justificativa não encontrada.' });
  }
};

exports.downloadDocument = async (req, res) => {
  try {
    const document = await absenceJustificationService.getDocument(req.user.schoolId, req.params.id);

    res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(document.fileName || 'documento')}"`
    );

    return res.send(document.data);
  } catch (error) {
    console.error('Erro ao baixar documento da justificativa:', error);
    return res.status(404).json({ message: error.message || 'Documento não encontrado.' });
  }
};

exports.review = async (req, res) => {
  try {
    const result = await absenceJustificationService.review(
      req.user.schoolId,
      req.params.id,
      req.body,
      req.user
    );

    appEmitter.emit('attendance_updated', {
      classId: String(result.classId?._id || result.classId),
      school_id: req.user.schoolId
    });

    return res.status(200).json({
      message: 'Justificativa revisada com sucesso.',
      data: result
    });
  } catch (error) {
    console.error('Erro ao revisar justificativa:', error);
    return res.status(400).json({ message: error.message || 'Erro ao revisar justificativa.' });
  }
};