const express = require('express');
const multer = require('multer');

const School = require('../models/school.model');
const Student = require('../models/student.model');
const ClassModel = require('../models/class.model');
const User = require('../models/user.model');
const SchoolSubscription = require('../models/schoolSubscription.model');
const SchoolSubscriptionPayment = require('../models/schoolSubscriptionPayment.model');
const SchoolService = require('../services/school.service');
const platformAdminService = require('../services/platformAdmin.service');
const r2StorageService = require('../services/r2Storage.service');
const activityLibraryService = require('../services/activityLibrary.service');
const {
  requireSuperAdmin,
  verifyPlatformToken,
} = require('../middlewares/platformAuth.middleware');

const router = express.Router();

const FILE_LIMIT_BYTES = 25 * 1024 * 1024;

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = error.status || error.statusCode || (error.name === 'ValidationError' ? 400 : 500);
      return res.status(status).json({
        message: error.message || 'Erro interno.',
        code: error.code || 'PLATFORM_ERROR',
      });
    }
  };
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return value;
  }
}

function parseStringArray(value) {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => normalizeText(item)).filter(Boolean);
  }
  if (typeof parsed === 'string') {
    return parsed.split(',').map((item) => normalizeText(item)).filter(Boolean);
  }
  return [];
}

function parseNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function normalizePagination(query = {}) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

function escapeRegex(value) {
  return normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOperationalStatus(value, fallback = 'active') {
  const status = normalizeText(value || fallback).toLowerCase();
  if (!['active', 'inactive', 'blocked', 'trial', 'cancelled'].includes(status)) {
    const error = new Error('Status operacional invalido.');
    error.status = 400;
    error.code = 'INVALID_OPERATIONAL_STATUS';
    throw error;
  }
  return status;
}

function normalizeSubscriptionStatus(value, fallback = 'pending') {
  const status = normalizeText(value || fallback).toLowerCase();
  if (!['active', 'overdue', 'paid', 'pending', 'cancelled', 'trial'].includes(status)) {
    const error = new Error('Status financeiro invalido.');
    error.status = 400;
    error.code = 'INVALID_SUBSCRIPTION_STATUS';
    throw error;
  }
  return status;
}

function normalizeBillingDay(value, fallback = 10) {
  const day = Number.parseInt(value, 10);
  if (!Number.isFinite(day)) return fallback;
  return Math.min(Math.max(day, 1), 31);
}

function buildDueDateFromBillingDay(billingDay, fromDate = new Date()) {
  const base = new Date(fromDate);
  const year = base.getFullYear();
  const month = base.getMonth();

  function makeDate(targetYear, targetMonth) {
    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    return new Date(targetYear, targetMonth, Math.min(normalizeBillingDay(billingDay), lastDay));
  }

  let dueDate = makeDate(year, month);
  if (dueDate < base) {
    dueDate = makeDate(year, month + 1);
  }

  return dueDate;
}

function sanitizeFileName(fileName) {
  const base = normalizeText(fileName || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);

  return base || 'arquivo';
}

function createUploadMiddleware(upload) {
  return (req, res, next) => upload(req, res, (error) => {
    if (!error) return next();

    const isSizeError = error.code === 'LIMIT_FILE_SIZE';
    return res.status(isSizeError ? 413 : 400).json({
      message: isSizeError ? 'Arquivo excede o limite de 25MB.' : error.message,
      code: isSizeError ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
    });
  });
}

const genericUpload = createUploadMiddleware(multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FILE_LIMIT_BYTES },
}).single('file'));

const pdfUpload = createUploadMiddleware(multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FILE_LIMIT_BYTES },
  fileFilter(req, file, cb) {
    const isPdfMime = String(file.mimetype || '').toLowerCase() === 'application/pdf';
    const isPdfName = String(file.originalname || '').toLowerCase().endsWith('.pdf');
    if (!isPdfMime || !isPdfName) {
      return cb(new Error('Apenas arquivos PDF com extensao .pdf sao permitidos.'));
    }
    return cb(null, true);
  },
}).single('file'));

function buildSchoolPayload(body = {}) {
  const status = normalizeOperationalStatus(body.initialStatus || body.status || 'active');
  const isBlocked = status === 'blocked';

  return {
    name: normalizeText(body.name),
    legalName: normalizeText(body.legalName),
    cnpj: normalizeText(body.document || body.cnpj),
    contactEmail: normalizeEmail(body.email || body.contactEmail),
    contactPhone: normalizeText(body.phone || body.contactPhone),
    address: {
      city: normalizeText(body.city || body['address.city']),
      state: normalizeText(body.state || body['address.state']),
      zipCode: normalizeText(body.zipCode || body['address.zipCode']),
      street: normalizeText(body.street || body['address.street']),
      number: normalizeText(body.number || body['address.number']),
      neighborhood: normalizeText(body.neighborhood || body['address.neighborhood']),
    },
    platformContact: {
      responsibleName: normalizeText(body.responsibleName),
      responsibleEmail: normalizeEmail(body.responsibleEmail),
      responsiblePhone: normalizeText(body.responsiblePhone),
    },
    platformAccess: {
      status,
      isBlocked,
      reason: '',
      notes: '',
      blockedAt: isBlocked ? new Date() : null,
      blockedUntil: null,
      blockedBy: null,
    },
  };
}

function buildSchoolUpdatePayload(body = {}) {
  const update = {};

  const fieldMap = {
    name: 'name',
    legalName: 'legalName',
    document: 'cnpj',
    cnpj: 'cnpj',
    email: 'contactEmail',
    contactEmail: 'contactEmail',
    phone: 'contactPhone',
    contactPhone: 'contactPhone',
  };

  for (const [source, target] of Object.entries(fieldMap)) {
    if (!Object.prototype.hasOwnProperty.call(body, source)) continue;
    update[target] = target === 'contactEmail' ? normalizeEmail(body[source]) : normalizeText(body[source]);
  }

  const addressMap = {
    city: 'address.city',
    state: 'address.state',
    zipCode: 'address.zipCode',
    street: 'address.street',
    number: 'address.number',
    neighborhood: 'address.neighborhood',
  };

  for (const [source, target] of Object.entries(addressMap)) {
    if (Object.prototype.hasOwnProperty.call(body, source)) {
      update[target] = normalizeText(body[source]);
    }
  }

  const contactMap = {
    responsibleName: 'platformContact.responsibleName',
    responsibleEmail: 'platformContact.responsibleEmail',
    responsiblePhone: 'platformContact.responsiblePhone',
  };

  for (const [source, target] of Object.entries(contactMap)) {
    if (Object.prototype.hasOwnProperty.call(body, source)) {
      update[target] = target.endsWith('Email') ? normalizeEmail(body[source]) : normalizeText(body[source]);
    }
  }

  return update;
}

function normalizeSchoolResponse(school) {
  const item = school?.toObject ? school.toObject() : school;
  if (!item) return null;

  return {
    id: String(item._id),
    name: item.name || '',
    legalName: item.legalName || '',
    document: item.cnpj || '',
    email: item.contactEmail || '',
    phone: item.contactPhone || '',
    city: item.address?.city || '',
    state: item.address?.state || '',
    address: item.address || {},
    platformContact: item.platformContact || {},
    platformAccess: item.platformAccess || { status: 'active', isBlocked: false },
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function getLatestPaymentMap(schoolIds) {
  const payments = await SchoolSubscriptionPayment.find({
    schoolId: { $in: schoolIds },
    status: 'paid',
  })
    .sort({ paidAt: -1, createdAt: -1 })
    .lean();

  const map = new Map();
  for (const payment of payments) {
    const key = String(payment.schoolId);
    if (!map.has(key)) map.set(key, payment);
  }
  return map;
}

async function buildSchoolTableRow(school, subscription, latestPayment) {
  const schoolId = school._id;
  const [studentCount, classCount, userCount] = await Promise.all([
    Student.countDocuments({ school_id: schoolId, isActive: true }),
    ClassModel.countDocuments({ school_id: schoolId }),
    User.countDocuments({ school_id: schoolId }),
  ]);

  const access = school.platformAccess || {};
  const operationalStatus = access.isBlocked ? 'blocked' : (access.status || 'active');

  return {
    id: String(schoolId),
    name: school.name || '',
    city: school.address?.city || '',
    state: school.address?.state || '',
    operationalStatus,
    financialStatus: subscription?.status || 'pending',
    planName: subscription?.planName || '',
    monthlyAmount: subscription?.monthlyAmount || 0,
    studentCount,
    classCount,
    userCount,
    isBlocked: Boolean(access.isBlocked || operationalStatus === 'blocked'),
    lastPaymentDate: subscription?.lastPaymentDate || latestPayment?.paidAt || null,
    nextDueDate: subscription?.nextDueDate || null,
    createdAt: school.createdAt,
  };
}

async function buildSchoolQuery(filters = {}) {
  const and = [];

  if (filters.search) {
    const regex = new RegExp(escapeRegex(filters.search), 'i');
    and.push({
      $or: [
        { name: regex },
        { legalName: regex },
        { cnpj: regex },
        { contactEmail: regex },
        { 'platformContact.responsibleName': regex },
        { 'platformContact.responsibleEmail': regex },
      ],
    });
  }

  if (filters.status) {
    const status = normalizeOperationalStatus(filters.status);
    if (status === 'active') {
      and.push({
        $or: [
          { 'platformAccess.status': 'active' },
          { 'platformAccess.status': { $exists: false } },
        ],
      });
    } else {
      and.push({ 'platformAccess.status': status });
    }
  }

  if (filters.city) {
    and.push({ 'address.city': new RegExp(`^${escapeRegex(filters.city)}$`, 'i') });
  }

  if (filters.state) {
    and.push({ 'address.state': new RegExp(`^${escapeRegex(filters.state)}$`, 'i') });
  }

  if (filters.planStatus) {
    const subscriptions = await SchoolSubscription.find({
      status: normalizeSubscriptionStatus(filters.planStatus),
    }).select('schoolId').lean();

    const ids = subscriptions.map((item) => item.schoolId);
    if (ids.length === 0) {
      and.push({ _id: { $in: [] } });
    } else {
      and.push({ _id: { $in: ids } });
    }
  }

  return and.length ? { $and: and } : {};
}

async function sendSchoolsList(req, res) {
  const { page, limit, skip } = normalizePagination(req.query);
  const query = await buildSchoolQuery(req.query);

  const [schools, total] = await Promise.all([
    School.find(query)
      .select('-logo.data')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    School.countDocuments(query),
  ]);

  const schoolIds = schools.map((school) => school._id);
  const [subscriptions, latestPaymentMap] = await Promise.all([
    SchoolSubscription.find({ schoolId: { $in: schoolIds } }).lean(),
    getLatestPaymentMap(schoolIds),
  ]);

  const subscriptionMap = new Map(subscriptions.map((item) => [String(item.schoolId), item]));
  const items = await Promise.all(schools.map((school) => buildSchoolTableRow(
    school,
    subscriptionMap.get(String(school._id)),
    latestPaymentMap.get(String(school._id))
  )));

  return res.status(200).json({ items, page, limit, total });
}

async function getOrCreateSubscription(schoolId, payload = {}) {
  const existing = await SchoolSubscription.findOne({ schoolId });
  if (existing) return existing;

  return SchoolSubscription.create({
    schoolId,
    planName: normalizeText(payload.planName) || 'Sem plano',
    monthlyAmount: parseNumber(payload.monthlyAmount, 0),
    billingDay: normalizeBillingDay(payload.billingDay),
    status: normalizeSubscriptionStatus(payload.status, 'pending'),
    nextDueDate: buildDueDateFromBillingDay(payload.billingDay || 10),
    notes: normalizeText(payload.notes),
  });
}

router.post('/auth/login', asyncRoute(async (req, res) => {
  const result = await platformAdminService.login(req.body.email || req.body.identifier, req.body.password);
  return res.status(200).json(result);
}));

router.use(verifyPlatformToken, requireSuperAdmin);

router.get('/auth/me', asyncRoute(async (req, res) => {
  return res.status(200).json({ admin: req.platformAdmin });
}));

router.get('/storage/health', asyncRoute(async (req, res) => {
  const health = r2StorageService.getHealth();
  return res.status(200).json({
    ok: health.ready,
    provider: 'cloudflare-r2',
    config: health,
  });
}));

router.post('/storage/test-upload', genericUpload, asyncRoute(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Campo file e obrigatorio.', code: 'FILE_REQUIRED' });
  }

  const safeFileName = sanitizeFileName(req.file.originalname || 'arquivo.bin');
  const key = `system/test/${Date.now()}-${safeFileName}`;
  const result = await r2StorageService.uploadBuffer({
    key,
    buffer: req.file.buffer,
    contentType: req.file.mimetype || 'application/octet-stream',
  });

  return res.status(201).json({
    key: result.key,
    contentType: req.file.mimetype || 'application/octet-stream',
    size: req.file.size || req.file.buffer.length,
  });
}));

router.get('/storage/test-download-url', asyncRoute(async (req, res) => {
  const key = normalizeText(req.query.key);
  if (!key) {
    return res.status(400).json({ message: 'key e obrigatorio.', code: 'KEY_REQUIRED' });
  }

  const exists = await r2StorageService.objectExists(key);
  if (!exists) {
    return res.status(404).json({ message: 'Objeto nao encontrado no R2.', code: 'OBJECT_NOT_FOUND' });
  }

  const result = await r2StorageService.getSignedDownloadUrl(key, req.query.expiresIn);
  return res.status(200).json(result);
}));

router.get('/billing/overview', asyncRoute(async (req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const activeSchoolQuery = {
    $and: [
      {
        $or: [
          { 'platformAccess.status': 'active' },
          { 'platformAccess.status': { $exists: false } },
        ],
      },
      {
        $or: [
          { 'platformAccess.isBlocked': false },
          { 'platformAccess.isBlocked': { $exists: false } },
        ],
      },
    ],
  };

  const [
    subscriptions,
    receivedPayments,
    activeSchools,
    blockedSchools,
    overdueSchools,
    activeSchoolDocs,
  ] = await Promise.all([
    SchoolSubscription.find({ status: { $ne: 'cancelled' } }).lean(),
    SchoolSubscriptionPayment.find({
      status: 'paid',
      paidAt: { $gte: monthStart, $lt: monthEnd },
    }).lean(),
    School.countDocuments(activeSchoolQuery),
    School.countDocuments({
      $or: [
        { 'platformAccess.isBlocked': true },
        { 'platformAccess.status': 'blocked' },
      ],
    }),
    SchoolSubscription.countDocuments({ status: 'overdue' }),
    School.find(activeSchoolQuery).select('_id').lean(),
  ]);

  const activeSchoolIds = activeSchoolDocs.map((school) => school._id);
  const [activeSchoolStudents, activeSchoolClasses] = await Promise.all([
    Student.countDocuments({ school_id: { $in: activeSchoolIds }, isActive: true }),
    ClassModel.countDocuments({ school_id: { $in: activeSchoolIds } }),
  ]);

  const expectedMonthlyRevenue = subscriptions
    .filter((item) => ['active', 'paid', 'pending', 'overdue', 'trial'].includes(item.status))
    .reduce((sum, item) => sum + Number(item.monthlyAmount || 0), 0);
  const receivedThisMonth = receivedPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const overdueRevenue = subscriptions
    .filter((item) => item.status === 'overdue')
    .reduce((sum, item) => sum + Number(item.monthlyAmount || 0), 0);

  return res.status(200).json({
    expectedMonthlyRevenue,
    receivedThisMonth,
    overdueRevenue,
    activeSchools,
    blockedSchools,
    overdueSchools,
    activeSchoolStudents,
    activeSchoolClasses,
  });
}));

router.get('/billing/schools', asyncRoute(async (req, res) => {
  if (!req.query.planStatus && req.query.status) {
    req.query.planStatus = req.query.status;
    delete req.query.status;
  }
  return sendSchoolsList(req, res);
}));

router.get('/billing/invoices', asyncRoute(async (req, res) => {
  const { page, limit, skip } = normalizePagination(req.query);
  const query = {};

  if (req.query.schoolId) query.schoolId = req.query.schoolId;
  if (req.query.status) query.status = normalizeText(req.query.status);

  const [payments, total] = await Promise.all([
    SchoolSubscriptionPayment.find(query)
      .populate('schoolId', 'name legalName')
      .sort({ paidAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SchoolSubscriptionPayment.countDocuments(query),
  ]);

  const items = payments.map((payment) => ({
    id: String(payment._id),
    schoolId: String(payment.schoolId?._id || payment.schoolId),
    schoolName: payment.schoolId?.name || '',
    amount: payment.amount,
    paidAt: payment.paidAt,
    method: payment.method,
    referenceMonth: payment.referenceMonth,
    status: payment.status,
    notes: payment.notes || '',
    createdAt: payment.createdAt,
  }));

  return res.status(200).json({ items, page, limit, total });
}));

router.get('/schools', asyncRoute(async (req, res) => {
  return sendSchoolsList(req, res);
}));

router.post('/schools', asyncRoute(async (req, res) => {
  const payload = buildSchoolPayload(req.body);
  const school = await SchoolService.createSchool(payload, null);

  let subscription = null;
  if (req.body.planName || req.body.monthlyAmount || req.body.billingDay) {
    subscription = await SchoolSubscription.create({
      schoolId: school._id,
      planName: normalizeText(req.body.planName) || 'Sem plano',
      monthlyAmount: parseNumber(req.body.monthlyAmount, 0),
      billingDay: normalizeBillingDay(req.body.billingDay),
      status: req.body.initialStatus === 'trial' ? 'trial' : 'pending',
      nextDueDate: buildDueDateFromBillingDay(req.body.billingDay || 10),
    });
  }

  return res.status(201).json({
    school: normalizeSchoolResponse(school),
    subscription,
  });
}));

router.get('/schools/:schoolId', asyncRoute(async (req, res) => {
  const school = await School.findById(req.params.schoolId).select('-logo.data').lean();
  if (!school) return res.status(404).json({ message: 'Escola nao encontrada.', code: 'SCHOOL_NOT_FOUND' });

  const subscription = await SchoolSubscription.findOne({ schoolId: req.params.schoolId }).lean();
  return res.status(200).json({
    school: normalizeSchoolResponse(school),
    subscription,
  });
}));

router.patch('/schools/:schoolId', asyncRoute(async (req, res) => {
  const updatePayload = buildSchoolUpdatePayload(req.body);
  const school = await SchoolService.updateSchool(req.params.schoolId, updatePayload, null);
  return res.status(200).json({ school: normalizeSchoolResponse(school) });
}));

router.post('/schools/:schoolId/activate', asyncRoute(async (req, res) => {
  const school = await School.findByIdAndUpdate(
    req.params.schoolId,
    {
      $set: {
        'platformAccess.status': 'active',
        'platformAccess.isBlocked': false,
        'platformAccess.unblockedAt': new Date(),
        'platformAccess.unblockedBy': req.platformAdmin.id,
      },
    },
    { new: true, runValidators: true }
  ).select('-logo.data');

  if (!school) return res.status(404).json({ message: 'Escola nao encontrada.', code: 'SCHOOL_NOT_FOUND' });
  return res.status(200).json({ message: 'Escola ativada com sucesso.', school: normalizeSchoolResponse(school) });
}));

router.post('/schools/:schoolId/inactivate', asyncRoute(async (req, res) => {
  const school = await School.findByIdAndUpdate(
    req.params.schoolId,
    {
      $set: {
        'platformAccess.status': 'inactive',
        'platformAccess.isBlocked': false,
      },
    },
    { new: true, runValidators: true }
  ).select('-logo.data');

  if (!school) return res.status(404).json({ message: 'Escola nao encontrada.', code: 'SCHOOL_NOT_FOUND' });
  return res.status(200).json({ message: 'Escola inativada com sucesso.', school: normalizeSchoolResponse(school) });
}));

router.post('/schools/:schoolId/block', asyncRoute(async (req, res) => {
  const school = await School.findByIdAndUpdate(
    req.params.schoolId,
    {
      $set: {
        'platformAccess.status': 'blocked',
        'platformAccess.isBlocked': true,
        'platformAccess.reason': normalizeText(req.body.reason),
        'platformAccess.notes': normalizeText(req.body.notes),
        'platformAccess.blockedAt': new Date(),
        'platformAccess.blockedUntil': parseDate(req.body.blockedUntil, null),
        'platformAccess.blockedBy': req.platformAdmin.id,
      },
    },
    { new: true, runValidators: true }
  ).select('-logo.data');

  if (!school) return res.status(404).json({ message: 'Escola nao encontrada.', code: 'SCHOOL_NOT_FOUND' });
  return res.status(200).json({
    message: 'Escola bloqueada com sucesso.',
    school: normalizeSchoolResponse(school),
  });
}));

router.post('/schools/:schoolId/unblock', asyncRoute(async (req, res) => {
  const school = await School.findByIdAndUpdate(
    req.params.schoolId,
    {
      $set: {
        'platformAccess.status': 'active',
        'platformAccess.isBlocked': false,
        'platformAccess.unblockedAt': new Date(),
        'platformAccess.unblockedBy': req.platformAdmin.id,
        'platformAccess.unblockNotes': normalizeText(req.body.notes),
      },
    },
    { new: true, runValidators: true }
  ).select('-logo.data');

  if (!school) return res.status(404).json({ message: 'Escola nao encontrada.', code: 'SCHOOL_NOT_FOUND' });
  return res.status(200).json({
    message: 'Escola desbloqueada com sucesso.',
    school: normalizeSchoolResponse(school),
  });
}));

router.get('/schools/:schoolId/overview', asyncRoute(async (req, res) => {
  const school = await School.findById(req.params.schoolId).select('-logo.data').lean();
  if (!school) return res.status(404).json({ message: 'Escola nao encontrada.', code: 'SCHOOL_NOT_FOUND' });

  const [subscription, latestPaymentMap] = await Promise.all([
    SchoolSubscription.findOne({ schoolId: req.params.schoolId }).lean(),
    getLatestPaymentMap([req.params.schoolId]),
  ]);

  const row = await buildSchoolTableRow(
    school,
    subscription,
    latestPaymentMap.get(String(req.params.schoolId))
  );

  return res.status(200).json({
    school: normalizeSchoolResponse(school),
    overview: row,
    subscription,
  });
}));

router.get('/schools/:schoolId/subscription', asyncRoute(async (req, res) => {
  const subscription = await SchoolSubscription.findOne({ schoolId: req.params.schoolId }).lean();
  return res.status(200).json({ subscription });
}));

router.patch('/schools/:schoolId/subscription', asyncRoute(async (req, res) => {
  const school = await School.findById(req.params.schoolId).select('_id').lean();
  if (!school) return res.status(404).json({ message: 'Escola nao encontrada.', code: 'SCHOOL_NOT_FOUND' });

  const payload = {
    planName: normalizeText(req.body.planName),
    monthlyAmount: parseNumber(req.body.monthlyAmount, undefined),
    billingDay: normalizeBillingDay(req.body.billingDay, undefined),
    status: req.body.status ? normalizeSubscriptionStatus(req.body.status) : undefined,
    lastPaymentDate: parseDate(req.body.lastPaymentDate, undefined),
    nextDueDate: parseDate(req.body.nextDueDate, undefined),
    notes: normalizeText(req.body.notes),
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === '') delete payload[key];
  });

  if (payload.billingDay && !payload.nextDueDate) {
    payload.nextDueDate = buildDueDateFromBillingDay(payload.billingDay);
  }

  const subscription = await SchoolSubscription.findOneAndUpdate(
    { schoolId: req.params.schoolId },
    {
      $set: payload,
      $setOnInsert: {
        schoolId: req.params.schoolId,
      },
    },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  return res.status(200).json({ subscription });
}));

router.post('/schools/:schoolId/subscription/payments', asyncRoute(async (req, res) => {
  const school = await School.findById(req.params.schoolId).select('_id').lean();
  if (!school) return res.status(404).json({ message: 'Escola nao encontrada.', code: 'SCHOOL_NOT_FOUND' });

  const subscription = await getOrCreateSubscription(req.params.schoolId);
  const paidAt = parseDate(req.body.paidAt, new Date());
  const amount = parseNumber(req.body.amount, subscription.monthlyAmount || 0);

  const payment = await SchoolSubscriptionPayment.create({
    schoolId: req.params.schoolId,
    subscriptionId: subscription._id,
    amount,
    paidAt,
    method: normalizeText(req.body.method) || 'other',
    referenceMonth: normalizeText(req.body.referenceMonth),
    notes: normalizeText(req.body.notes),
    createdBy: req.platformAdmin.id,
  });

  subscription.lastPaymentDate = paidAt;
  subscription.status = 'paid';
  subscription.nextDueDate = buildDueDateFromBillingDay(subscription.billingDay, paidAt);
  await subscription.save();

  return res.status(201).json({ payment, subscription });
}));

router.patch('/schools/:schoolId/subscription/payments/:paymentId', asyncRoute(async (req, res) => {
  const update = {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'amount')) update.amount = parseNumber(req.body.amount, 0);
  if (Object.prototype.hasOwnProperty.call(req.body, 'paidAt')) update.paidAt = parseDate(req.body.paidAt, new Date());
  if (Object.prototype.hasOwnProperty.call(req.body, 'method')) update.method = normalizeText(req.body.method) || 'other';
  if (Object.prototype.hasOwnProperty.call(req.body, 'referenceMonth')) update.referenceMonth = normalizeText(req.body.referenceMonth);
  if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) update.notes = normalizeText(req.body.notes);
  if (Object.prototype.hasOwnProperty.call(req.body, 'status')) update.status = normalizeText(req.body.status);

  const payment = await SchoolSubscriptionPayment.findOneAndUpdate(
    { _id: req.params.paymentId, schoolId: req.params.schoolId },
    { $set: update },
    { new: true, runValidators: true }
  );

  if (!payment) return res.status(404).json({ message: 'Pagamento nao encontrado.', code: 'PAYMENT_NOT_FOUND' });

  const latestPayment = await SchoolSubscriptionPayment.findOne({
    schoolId: req.params.schoolId,
    status: 'paid',
  }).sort({ paidAt: -1, createdAt: -1 });

  if (latestPayment) {
    const subscription = await SchoolSubscription.findOne({ schoolId: req.params.schoolId }).select('billingDay');
    await SchoolSubscription.findOneAndUpdate(
      { schoolId: req.params.schoolId },
      {
        $set: {
          lastPaymentDate: latestPayment.paidAt,
          nextDueDate: buildDueDateFromBillingDay(subscription?.billingDay || 10, latestPayment.paidAt),
        },
      }
    );
  }

  return res.status(200).json({ payment });
}));

router.get('/activity-books', asyncRoute(async (req, res) => {
  const result = await activityLibraryService.listActivityBooks(req.query);
  return res.status(200).json(result);
}));

router.post('/activity-books', pdfUpload, asyncRoute(async (req, res) => {
  const result = await activityLibraryService.createActivityBook({
    body: req.body,
    file: req.file,
    adminId: req.platformAdmin.id,
  });

  return res.status(201).json(result);
}));

router.get('/activity-books/:bookId', asyncRoute(async (req, res) => {
  const book = await activityLibraryService.getActivityBook(req.params.bookId);
  return res.status(200).json({ book });
}));

router.patch('/activity-books/:bookId', asyncRoute(async (req, res) => {
  const book = await activityLibraryService.updateActivityBook(req.params.bookId, req.body);
  return res.status(200).json({ book });
}));

router.delete('/activity-books/:bookId', asyncRoute(async (req, res) => {
  const book = await activityLibraryService.archiveActivityBook(req.params.bookId);
  return res.status(200).json({
    message: 'ActivityBook arquivado com sucesso. Arquivo fisico preservado no R2.',
    book,
  });
}));

router.get('/activity-books/:bookId/pages', asyncRoute(async (req, res) => {
  const pages = await activityLibraryService.listPages(req.params.bookId);
  return res.status(200).json({ items: pages, total: pages.length });
}));

router.patch('/activity-pages/:pageId', asyncRoute(async (req, res) => {
  const page = await activityLibraryService.updatePage(req.params.pageId, req.body);
  return res.status(200).json({ page });
}));

router.patch('/activity-pages/:pageId/header-overlay', asyncRoute(async (req, res) => {
  const page = await activityLibraryService.updateHeaderOverlay(req.params.pageId, req.body);
  return res.status(200).json({ page });
}));

router.post('/activity-books/:bookId/visibility', asyncRoute(async (req, res) => {
  const book = await activityLibraryService.updateVisibility(req.params.bookId, req.body);
  return res.status(200).json({ book });
}));

router.post('/activity-books/:bookId/publish', asyncRoute(async (req, res) => {
  const book = await activityLibraryService.publishBook(req.params.bookId);
  return res.status(200).json({ message: 'ActivityBook publicado com sucesso.', book });
}));

router.post('/activity-books/:bookId/unpublish', asyncRoute(async (req, res) => {
  const book = await activityLibraryService.unpublishBook(req.params.bookId);
  return res.status(200).json({ message: 'ActivityBook despublicado com sucesso.', book });
}));

module.exports = router;
