const service = require('../services/invoiceCompensation.service');

function mapError(res, err) {
  const msg = err.message || 'UNKNOWN_ERROR';
  const status = [
    'TARGET_INVOICE_NOT_FOUND',
    'SOURCE_INVOICE_NOT_FOUND',
    'COMPENSATION_NOT_FOUND'
  ].includes(msg) ? 404
    : ['SOURCE_INVOICE_NOT_PAID', 'TARGET_INVOICE_CANCELED', 'SOURCE_INVOICE_CANCELED', 'COMPENSATION_NOT_ACTIVE'].includes(msg) ? 400
    : 500;

  return res.status(status).json({ ok: false, error: msg });
}

exports.create = async (req, res) => {
  try {
    const school_id = req.user.school_id;      // adapte ao seu middleware
    const created_by = req.user._id;

    const comp = await service.createCompensation({
      school_id,
      created_by,
      ...req.body
    });

    return res.status(201).json({ ok: true, data: comp });
  } catch (err) {
    return mapError(res, err);
  }
};

exports.list = async (req, res) => {
  try {
    const school_id = req.user.school_id;
    const { status, student } = req.query;

    const data = await service.listCompensations({ school_id, status, student });
    return res.json({ ok: true, data });
  } catch (err) {
    return mapError(res, err);
  }
};

exports.resolve = async (req, res) => {
  try {
    const school_id = req.user.school_id;
    const resolved_by = req.user._id;

    const data = await service.resolveCompensation({ school_id, id: req.params.id, resolved_by });
    return res.json({ ok: true, data });
  } catch (err) {
    return mapError(res, err);
  }
};

exports.cancel = async (req, res) => {
  try {
    const school_id = req.user.school_id;
    const resolved_by = req.user._id;

    const data = await service.cancelCompensation({ school_id, id: req.params.id, resolved_by });
    return res.json({ ok: true, data });
  } catch (err) {
    return mapError(res, err);
  }
};