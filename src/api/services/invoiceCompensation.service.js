const Invoice = require('../models/invoice.model');
const InvoiceCompensation = require('../models/invoice_compensation.model');

async function createCompensation({ school_id, student, target_invoice, source_invoice, reason, notes, created_by }) {
  // 1) valida invoices existem e pertencem à mesma escola/aluno
  const [target, source] = await Promise.all([
    Invoice.findOne({ _id: target_invoice, school_id, student }),
    Invoice.findOne({ _id: source_invoice, school_id, student })
  ]);

  if (!target) throw new Error('TARGET_INVOICE_NOT_FOUND');
  if (!source) throw new Error('SOURCE_INVOICE_NOT_FOUND');

  // 2) não faz sentido compensar invoice cancelada
  if (target.status === 'canceled') throw new Error('TARGET_INVOICE_CANCELED');
  if (source.status === 'canceled') throw new Error('SOURCE_INVOICE_CANCELED');

  // 3) fonte idealmente precisa estar paga (foi o “pagou errado”)
  if (source.status !== 'paid') throw new Error('SOURCE_INVOICE_NOT_PAID');

  // 4) cria
  const comp = await InvoiceCompensation.create({
    school_id,
    student,
    target_invoice,
    source_invoice,
    reason,
    notes,
    created_by
  });

  return comp;
}

async function listCompensations({ school_id, status, student }) {
  const query = { school_id };
  if (status) query.status = status;
  if (student) query.student = student;

  return InvoiceCompensation
    .find(query)
    .populate('student', 'name')
    .populate('target_invoice', 'description dueDate status value')
    .populate('source_invoice', 'description dueDate status value paidAt')
    .sort({ createdAt: -1 });
}

async function getCompensationByInvoice({ school_id, invoice_id }) {
  return InvoiceCompensation.findOne({
    school_id,
    status: 'active',
    target_invoice: invoice_id
  });
}

async function resolveCompensation({ school_id, id, resolved_by }) {
  const comp = await InvoiceCompensation.findOne({ _id: id, school_id });
  if (!comp) throw new Error('COMPENSATION_NOT_FOUND');
  if (comp.status !== 'active') throw new Error('COMPENSATION_NOT_ACTIVE');

  comp.status = 'resolved';
  comp.resolved_at = new Date();
  comp.resolved_by = resolved_by;
  await comp.save();

  return comp;
}

async function cancelCompensation({ school_id, id, resolved_by }) {
  const comp = await InvoiceCompensation.findOne({ _id: id, school_id });
  if (!comp) throw new Error('COMPENSATION_NOT_FOUND');
  if (comp.status !== 'active') throw new Error('COMPENSATION_NOT_ACTIVE');

  comp.status = 'canceled';
  comp.resolved_at = new Date();
  comp.resolved_by = resolved_by;
  await comp.save();

  return comp;
}

module.exports = {
  createCompensation,
  listCompensations,
  getCompensationByInvoice,
  resolveCompensation,
  cancelCompensation
};