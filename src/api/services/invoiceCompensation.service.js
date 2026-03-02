const Invoice = require('../models/invoice.model');
const InvoiceCompensation = require('../models/invoice_compensation.model');

function formatMMYYYY(date) {
  if (!date) return null;
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${mm}/${yyyy}`;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * ✅ Regra do propósito real:
 * - Criar um HOLD na TARGET até "hold_until"
 * - Default de hold_until: vencimento da SOURCE (boleto pago errado)
 */
async function createCompensation({
  school_id,
  student,
  target_invoice,
  source_invoice,
  reason,
  notes,
  created_by,
  hold_until // opcional (se não vier, calcula)
}) {
  // 1) valida invoices existem e pertencem à mesma escola/aluno
  const [target, source] = await Promise.all([
    Invoice.findOne({ _id: target_invoice, school_id, student }),
    Invoice.findOne({ _id: source_invoice, school_id, student })
  ]);

  if (!target) throw new Error('TARGET_INVOICE_NOT_FOUND');
  if (!source) throw new Error('SOURCE_INVOICE_NOT_FOUND');

  if (String(target._id) === String(source._id)) {
    throw new Error('TARGET_SOURCE_CANNOT_BE_SAME');
  }

  // 2) não faz sentido bloquear invoice cancelada
  if (target.status === 'canceled') throw new Error('TARGET_INVOICE_CANCELED');
  if (source.status === 'canceled') throw new Error('SOURCE_INVOICE_CANCELED');

  // 3) target deve ser “cobrável” (pending/overdue). Se já está paga, não faz sentido hold.
  if (target.status === 'paid') throw new Error('TARGET_INVOICE_ALREADY_PAID');

  // 4) fonte precisa estar paga (foi o “pagou errado”)
  if (source.status !== 'paid') throw new Error('SOURCE_INVOICE_NOT_PAID');

  // 5) calcula hold_until padrão: vencimento da source (boleto pago errado)
  //    (você pode trocar pra "fim do mês" depois, se quiser)
  let holdUntilDate = hold_until ? new Date(hold_until) : null;
  if (!holdUntilDate || isNaN(holdUntilDate.getTime())) {
    if (!source.dueDate) throw new Error('SOURCE_INVOICE_DUEDATE_REQUIRED');
    holdUntilDate = endOfDay(source.dueDate);
  }

  // 6) cria HOLD
  const comp = await InvoiceCompensation.create({
    school_id,
    student,
    target_invoice,
    source_invoice,
    hold_until: holdUntilDate,
    cash_month: formatMMYYYY(source.paidAt || source.effectivePaidAt || source.updatedAt),
    competence_month: formatMMYYYY(target.dueDate),
    reason,
    notes,
    created_by,
    status: 'active'
  });

  return comp;
}

async function _expireDueHolds({ school_id }) {
  const now = new Date();
  // expira o que já passou do hold_until
  await InvoiceCompensation.updateMany(
    {
      school_id,
      status: 'active',
      hold_until: { $lt: startOfDay(now) }
    },
    { $set: { status: 'expired' } }
  );
}

async function listCompensations({ school_id, status, student }) {
  // ✅ auto-expire antes de listar (pra UI sempre bater)
  await _expireDueHolds({ school_id });

  const query = { school_id };
  if (status) query.status = status;
  if (student) query.student = student;

  return InvoiceCompensation
    .find(query)
    .populate('student', 'name fullName')
    .populate('target_invoice', 'description dueDate status value')
    .populate('source_invoice', 'description dueDate status value paidAt effectivePaidAt')
    .sort({ createdAt: -1 });
}

/**
 * ✅ Usado pelo disparo de cobrança:
 * Se existir HOLD ativo e hold_until >= hoje => não cobrar
 */
async function getCompensationByInvoice({ school_id, invoice_id }) {
  // garante expiração
  await _expireDueHolds({ school_id });

  const now = new Date();

  return InvoiceCompensation.findOne({
    school_id,
    status: 'active',
    target_invoice: invoice_id,
    hold_until: { $gte: startOfDay(now) }
  });
}

async function resolveCompensation({ school_id, id, resolved_by }) {
  const comp = await InvoiceCompensation.findOne({ _id: id, school_id });
  if (!comp) throw new Error('COMPENSATION_NOT_FOUND');

  // se já expirou, ainda pode resolver (vira encerramento manual)
  if (!['active', 'expired'].includes(comp.status)) {
    throw new Error('COMPENSATION_NOT_ACTIVE');
  }

  comp.status = 'resolved';
  comp.resolved_at = new Date();
  comp.resolved_by = resolved_by;
  await comp.save();

  return comp;
}

async function cancelCompensation({ school_id, id, resolved_by }) {
  const comp = await InvoiceCompensation.findOne({ _id: id, school_id });
  if (!comp) throw new Error('COMPENSATION_NOT_FOUND');
  if (!['active', 'expired'].includes(comp.status)) {
    throw new Error('COMPENSATION_NOT_ACTIVE');
  }

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