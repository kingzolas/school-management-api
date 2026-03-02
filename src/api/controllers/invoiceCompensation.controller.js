const service = require('../services/invoiceCompensation.service');

function mapError(res, err) {
  const msg = err.message || 'UNKNOWN_ERROR';

  const status =
    [
      'TARGET_INVOICE_NOT_FOUND',
      'SOURCE_INVOICE_NOT_FOUND',
      'COMPENSATION_NOT_FOUND'
    ].includes(msg) ? 404
    : [
      'SOURCE_INVOICE_NOT_PAID',
      'TARGET_INVOICE_CANCELED',
      'SOURCE_INVOICE_CANCELED',
      'TARGET_INVOICE_ALREADY_PAID',
      'COMPENSATION_NOT_ACTIVE',
      'TARGET_SOURCE_CANNOT_BE_SAME',
      'SOURCE_INVOICE_DUEDATE_REQUIRED'
    ].includes(msg) ? 400
    : 500;

  return res.status(status).json({ ok: false, error: msg });
}

exports.create = async (req, res) => {
  try {
    const school_id = req.user.school_id;  // seu middleware
    const created_by = req.user._id;

    const comp = await service.createCompensation({
      school_id,
      created_by,
      ...req.body
      /**
       * req.body pode conter (opcional):
       * - hold_until (Date)
       * se não vier, o service calcula com base na SOURCE.dueDate
       */
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

    const data = await service.resolveCompensation({
      school_id,
      id: req.params.id,
      resolved_by
    });

    return res.json({ ok: true, data });
  } catch (err) {
    return mapError(res, err);
  }
};

exports.cancel = async (req, res) => {
  try {
    const school_id = req.user.school_id;
    const resolved_by = req.user._id;

    const data = await service.cancelCompensation({
      school_id,
      id: req.params.id,
      resolved_by
    });

    return res.json({ ok: true, data });
  } catch (err) {
    return mapError(res, err);
  }
};