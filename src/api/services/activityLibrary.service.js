const mongoose = require('mongoose');
const { PDFDocument } = require('pdf-lib');

const ActivityBook = require('../models/activityBook.model');
const ActivityPage = require('../models/activityPage.model');
const r2StorageService = require('./r2Storage.service');

const PDF_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

function createHttpError(message, status = 400, code = 'ACTIVITY_LIBRARY_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseJsonMaybe(value) {
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
  const parsed = parseJsonMaybe(value);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => normalizeText(item)).filter(Boolean);
  }

  if (typeof parsed === 'string') {
    return parsed.split(',').map((item) => normalizeText(item)).filter(Boolean);
  }

  return [];
}

function parseObjectIdArray(value, fieldName = 'ids') {
  const ids = parseStringArray(value);
  const invalid = ids.find((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalid) {
    throw createHttpError(`${fieldName} contem um id invalido.`, 400, 'INVALID_OBJECT_ID');
  }

  return ids;
}

function normalizePagination(query = {}) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

function normalizeVisibility(value) {
  const visibility = normalizeText(value || 'private').toLowerCase();
  if (!['global', 'restricted', 'private'].includes(visibility)) {
    throw createHttpError('Visibility invalida.', 400, 'INVALID_VISIBILITY');
  }
  return visibility;
}

function normalizeTags(value) {
  return [...new Set(parseStringArray(value).map((tag) => tag.toLowerCase()))];
}

function assertValidPdfFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw createHttpError('Arquivo PDF e obrigatorio.', 400, 'PDF_REQUIRED');
  }

  const fileSize = Number(file.size || file.buffer.length || 0);
  if (fileSize <= 0) {
    throw createHttpError('O PDF enviado esta vazio.', 400, 'EMPTY_PDF');
  }

  if (fileSize > PDF_UPLOAD_LIMIT_BYTES) {
    throw createHttpError('O PDF excede o limite de 25MB.', 413, 'PDF_TOO_LARGE');
  }

  if (String(file.mimetype || '').toLowerCase() !== 'application/pdf') {
    throw createHttpError('Apenas arquivos PDF sao permitidos.', 400, 'INVALID_PDF_MIMETYPE');
  }

  if (!String(file.originalname || '').toLowerCase().endsWith('.pdf')) {
    throw createHttpError('O arquivo deve usar extensao .pdf.', 400, 'INVALID_PDF_EXTENSION');
  }

  const header = file.buffer.subarray(0, 5).toString('ascii');
  if (header !== '%PDF-') {
    throw createHttpError('O arquivo enviado nao possui assinatura PDF valida.', 400, 'INVALID_PDF_SIGNATURE');
  }
}

async function countPdfPages(file) {
  assertValidPdfFile(file);

  try {
    const document = await PDFDocument.load(file.buffer);
    return document.getPageCount();
  } catch (error) {
    throw createHttpError(
      'Nao foi possivel ler o PDF. Verifique se o arquivo nao esta corrompido, protegido ou criptografado.',
      400,
      'INVALID_OR_ENCRYPTED_PDF'
    );
  }
}

function publicPdfUrlFromUpload(uploadResult) {
  return uploadResult?.publicUrl || '';
}

class ActivityLibraryService {
  getPdfUploadLimitBytes() {
    return PDF_UPLOAD_LIMIT_BYTES;
  }

  async createActivityBook({ body = {}, file, adminId }) {
    const title = normalizeText(body.title);
    if (!title) {
      throw createHttpError('title e obrigatorio.', 400, 'TITLE_REQUIRED');
    }

    const totalPages = await countPdfPages(file);
    if (!totalPages) {
      throw createHttpError('O PDF precisa conter pelo menos uma pagina.', 400, 'PDF_WITHOUT_PAGES');
    }

    const visibility = normalizeVisibility(body.visibility);
    const allowedSchoolIds = parseObjectIdArray(body.allowedSchoolIds, 'allowedSchoolIds');
    if (visibility === 'restricted' && allowedSchoolIds.length === 0) {
      throw createHttpError('allowedSchoolIds e obrigatorio quando visibility=restricted.', 400, 'ALLOWED_SCHOOLS_REQUIRED');
    }

    const book = new ActivityBook({
      title,
      subject: normalizeText(body.subject),
      segment: normalizeText(body.segment),
      grade: normalizeText(body.grade),
      description: normalizeText(body.description),
      visibility,
      allowedSchoolIds,
      status: 'processing',
      createdBy: adminId,
    });

    await book.save();

    const originalPdfKey = `platform/activity-books/${book._id}/original.pdf`;

    try {
      const uploadResult = await r2StorageService.uploadBuffer({
        key: originalPdfKey,
        buffer: file.buffer,
        contentType: 'application/pdf',
      });

      const pages = Array.from({ length: totalPages }, (_, index) => ({
        bookId: book._id,
        pageNumber: index + 1,
        title: `${title} - Pagina ${index + 1}`,
        description: normalizeText(body.description),
        subject: normalizeText(body.subject),
        segment: normalizeText(body.segment),
        grade: normalizeText(body.grade),
        tags: normalizeTags(body.tags),
        enabled: true,
        status: 'draft',
      }));

      await ActivityPage.insertMany(pages);

      book.originalPdfKey = originalPdfKey;
      book.originalPdfUrl = publicPdfUrlFromUpload(uploadResult);
      book.totalPages = totalPages;
      book.status = 'ready';
      await book.save();

      return {
        book,
        pagesCreated: totalPages,
      };
    } catch (error) {
      await ActivityPage.deleteMany({ bookId: book._id }).catch(() => {});
      await ActivityBook.findByIdAndUpdate(book._id, {
        $set: {
          status: 'draft',
          processingError: error.message || 'Falha ao processar PDF.',
        },
      }).catch(() => {});
      throw error;
    }
  }

  async listActivityBooks(filters = {}) {
    const { page, limit, skip } = normalizePagination(filters);
    const query = {};

    if (filters.status) {
      query.status = normalizeText(filters.status);
    } else {
      query.status = { $ne: 'archived' };
    }

    if (filters.visibility) query.visibility = normalizeVisibility(filters.visibility);
    if (filters.subject) query.subject = normalizeText(filters.subject);
    if (filters.segment) query.segment = normalizeText(filters.segment);
    if (filters.grade) query.grade = normalizeText(filters.grade);

    if (filters.search) {
      const regex = new RegExp(escapeRegex(filters.search), 'i');
      query.$or = [
        { title: regex },
        { description: regex },
        { subject: regex },
        { segment: regex },
        { grade: regex },
      ];
    }

    const [items, total] = await Promise.all([
      ActivityBook.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ActivityBook.countDocuments(query),
    ]);

    return { items, page, limit, total };
  }

  async getActivityBook(bookId) {
    const book = await ActivityBook.findById(bookId).lean();
    if (!book || book.status === 'archived') {
      throw createHttpError('ActivityBook nao encontrado.', 404, 'BOOK_NOT_FOUND');
    }
    return book;
  }

  async updateActivityBook(bookId, payload = {}) {
    const allowedFields = [
      'title',
      'subject',
      'segment',
      'grade',
      'description',
      'sourceType',
      'visibility',
      'allowedSchoolIds',
    ];

    const update = {};
    for (const field of allowedFields) {
      if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;

      if (field === 'allowedSchoolIds') {
        update.allowedSchoolIds = parseObjectIdArray(payload.allowedSchoolIds, 'allowedSchoolIds');
      } else if (field === 'visibility') {
        update.visibility = normalizeVisibility(payload.visibility);
      } else {
        update[field] = normalizeText(payload[field]);
      }
    }

    if (update.visibility === 'restricted' && (!update.allowedSchoolIds || update.allowedSchoolIds.length === 0)) {
      const current = await ActivityBook.findById(bookId).select('allowedSchoolIds').lean();
      if (!current?.allowedSchoolIds?.length) {
        throw createHttpError('allowedSchoolIds e obrigatorio quando visibility=restricted.', 400, 'ALLOWED_SCHOOLS_REQUIRED');
      }
    }

    const book = await ActivityBook.findOneAndUpdate(
      { _id: bookId, status: { $ne: 'archived' } },
      { $set: update },
      { new: true, runValidators: true }
    ).lean();

    if (!book) {
      throw createHttpError('ActivityBook nao encontrado.', 404, 'BOOK_NOT_FOUND');
    }

    return book;
  }

  async archiveActivityBook(bookId) {
    const book = await ActivityBook.findOneAndUpdate(
      { _id: bookId, status: { $ne: 'archived' } },
      { $set: { status: 'archived' } },
      { new: true }
    ).lean();

    if (!book) {
      throw createHttpError('ActivityBook nao encontrado.', 404, 'BOOK_NOT_FOUND');
    }

    await ActivityPage.updateMany({ bookId }, { $set: { status: 'archived', enabled: false } });
    return book;
  }

  async listPages(bookId) {
    await this.getActivityBook(bookId);
    return ActivityPage.find({ bookId })
      .sort({ pageNumber: 1 })
      .lean();
  }

  async updatePage(pageId, payload = {}) {
    const allowedFields = [
      'title',
      'description',
      'subject',
      'segment',
      'grade',
      'tags',
      'enabled',
      'status',
    ];

    const update = {};
    for (const field of allowedFields) {
      if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;

      if (field === 'tags') update.tags = normalizeTags(payload.tags);
      else if (field === 'enabled') update.enabled = payload.enabled === true || payload.enabled === 'true';
      else update[field] = normalizeText(payload[field]);
    }

    const page = await ActivityPage.findByIdAndUpdate(
      pageId,
      { $set: update },
      { new: true, runValidators: true }
    ).lean();

    if (!page) {
      throw createHttpError('ActivityPage nao encontrada.', 404, 'PAGE_NOT_FOUND');
    }

    return page;
  }

  async updateHeaderOverlay(pageId, payload = {}) {
    const fields = ['xPct', 'yPct', 'widthPct', 'heightPct'];
    const update = {};

    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
      const value = Number(payload[field]);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw createHttpError(`${field} precisa ser um numero entre 0 e 100.`, 400, 'INVALID_HEADER_OVERLAY');
      }
      update[`headerOverlay.${field}`] = value;
    }

    const page = await ActivityPage.findByIdAndUpdate(
      pageId,
      { $set: update },
      { new: true, runValidators: true }
    ).lean();

    if (!page) {
      throw createHttpError('ActivityPage nao encontrada.', 404, 'PAGE_NOT_FOUND');
    }

    return page;
  }

  async updateVisibility(bookId, payload = {}) {
    const visibility = normalizeVisibility(payload.visibility);
    const allowedSchoolIds = parseObjectIdArray(payload.allowedSchoolIds, 'allowedSchoolIds');

    if (visibility === 'restricted' && allowedSchoolIds.length === 0) {
      throw createHttpError('allowedSchoolIds e obrigatorio quando visibility=restricted.', 400, 'ALLOWED_SCHOOLS_REQUIRED');
    }

    const book = await ActivityBook.findOneAndUpdate(
      { _id: bookId, status: { $ne: 'archived' } },
      { $set: { visibility, allowedSchoolIds } },
      { new: true, runValidators: true }
    ).lean();

    if (!book) {
      throw createHttpError('ActivityBook nao encontrado.', 404, 'BOOK_NOT_FOUND');
    }

    return book;
  }

  async publishBook(bookId) {
    const book = await ActivityBook.findOneAndUpdate(
      { _id: bookId, status: { $in: ['ready', 'published'] } },
      { $set: { status: 'published' } },
      { new: true, runValidators: true }
    ).lean();

    if (!book) {
      throw createHttpError('ActivityBook precisa estar ready para publicar.', 409, 'BOOK_NOT_READY');
    }

    await ActivityPage.updateMany(
      { bookId, enabled: true, status: { $ne: 'archived' } },
      { $set: { status: 'published' } }
    );
    await ActivityPage.updateMany(
      { bookId, enabled: false, status: 'published' },
      { $set: { status: 'draft' } }
    );

    return book;
  }

  async unpublishBook(bookId) {
    const book = await ActivityBook.findOneAndUpdate(
      { _id: bookId, status: 'published' },
      { $set: { status: 'ready' } },
      { new: true, runValidators: true }
    ).lean();

    if (!book) {
      throw createHttpError('ActivityBook publicado nao encontrado.', 404, 'BOOK_NOT_FOUND');
    }

    await ActivityPage.updateMany(
      { bookId, status: 'published' },
      { $set: { status: 'ready' } }
    );

    return book;
  }

  async listSchoolLibrary(schoolId, filters = {}) {
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      throw createHttpError('Escola invalida.', 400, 'INVALID_SCHOOL_ID');
    }

    const { page, limit, skip } = normalizePagination(filters);
    const visibleBookQuery = {
      status: 'published',
      $or: [
        { visibility: 'global' },
        { visibility: 'restricted', allowedSchoolIds: schoolId },
      ],
    };

    const visibleBooks = await ActivityBook.find(visibleBookQuery)
      .select('_id title subject segment grade visibility')
      .lean();

    const visibleBookIds = visibleBooks.map((book) => book._id);
    if (visibleBookIds.length === 0) {
      return { items: [], page, limit, total: 0 };
    }

    const bookById = new Map(visibleBooks.map((book) => [String(book._id), book]));
    const pageQuery = {
      bookId: { $in: visibleBookIds },
      enabled: true,
      status: 'published',
    };

    if (filters.subject) pageQuery.subject = normalizeText(filters.subject);
    if (filters.segment) pageQuery.segment = normalizeText(filters.segment);
    if (filters.grade) pageQuery.grade = normalizeText(filters.grade);

    const tags = normalizeTags(filters.tags);
    if (tags.length > 0) pageQuery.tags = { $in: tags };

    if (filters.search) {
      const regex = new RegExp(escapeRegex(filters.search), 'i');
      const matchingBookIds = visibleBooks
        .filter((book) => regex.test(book.title || ''))
        .map((book) => book._id);

      pageQuery.$or = [
        { title: regex },
        { description: regex },
        { subject: regex },
        { segment: regex },
        { grade: regex },
      ];

      if (matchingBookIds.length > 0) {
        pageQuery.$or.push({ bookId: { $in: matchingBookIds } });
      }
    }

    const [pages, total] = await Promise.all([
      ActivityPage.find(pageQuery)
        .sort({ updatedAt: -1, pageNumber: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ActivityPage.countDocuments(pageQuery),
    ]);

    const items = pages.map((activityPage) => {
      const book = bookById.get(String(activityPage.bookId)) || {};
      return {
        activityPageId: String(activityPage._id),
        bookId: String(activityPage.bookId),
        title: activityPage.title || `${book.title || 'Atividade'} - Pagina ${activityPage.pageNumber}`,
        description: activityPage.description || '',
        subject: activityPage.subject || book.subject || '',
        segment: activityPage.segment || book.segment || '',
        grade: activityPage.grade || book.grade || '',
        pageNumber: activityPage.pageNumber,
        thumbnailUrl: activityPage.thumbnailUrl || '',
        tags: activityPage.tags || [],
        bookTitle: book.title || '',
      };
    });

    return { items, page, limit, total };
  }
}

module.exports = new ActivityLibraryService();
