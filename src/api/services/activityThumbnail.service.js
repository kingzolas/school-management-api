const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { createCanvas, DOMMatrix, ImageData, Path2D } = require('@napi-rs/canvas');

const ActivityBook = require('../models/activityBook.model');
const ActivityPage = require('../models/activityPage.model');
const r2StorageService = require('./r2Storage.service');

const THUMBNAIL_CONTENT_TYPE = 'image/png';
const THUMBNAIL_EXTENSION = 'png';
const THUMBNAIL_TARGET_WIDTH = 320;
const THUMBNAIL_EXPIRES_IN_SECONDS = 900;
const THUMBNAIL_MAX_ERROR_LENGTH = 240;

function createHttpError(message, status = 400, code = 'ACTIVITY_THUMBNAIL_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function buildThumbnailKey(bookId, pageNumber, extension = THUMBNAIL_EXTENSION) {
  const normalizedPageNumber = Number(pageNumber);
  if (!Number.isInteger(normalizedPageNumber) || normalizedPageNumber <= 0) {
    throw createHttpError('pageNumber invalido para thumbnail.', 400, 'INVALID_THUMBNAIL_PAGE_NUMBER');
  }

  return `platform/activity-books/${bookId}/thumbnails/page-${String(normalizedPageNumber).padStart(3, '0')}.${extension}`;
}

function normalizePageList(pageNumbers, availablePages = []) {
  const availablePageNumbers = availablePages.map((page) => Number(page.pageNumber)).filter(Number.isInteger);
  const maxPageNumber = availablePageNumbers.length > 0 ? Math.max(...availablePageNumbers) : 0;

  if (pageNumbers === undefined || pageNumbers === null) {
    return [...availablePageNumbers].sort((left, right) => left - right);
  }

  const values = Array.isArray(pageNumbers)
    ? pageNumbers
    : [pageNumbers];

  const unique = [];
  values.forEach((value) => {
    const pageNumber = Number(value);
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
      throw createHttpError('pageNumbers precisa conter inteiros positivos.', 400, 'INVALID_PAGE_NUMBERS');
    }
    if (availablePageNumbers.length > 0 && !availablePageNumbers.includes(pageNumber)) {
      throw createHttpError(`Pagina ${pageNumber} nao encontrada neste caderno.`, 400, 'INVALID_PAGE_NUMBERS');
    }
    if (availablePageNumbers.length === 0 && pageNumber > maxPageNumber && maxPageNumber > 0) {
      throw createHttpError(`Pagina ${pageNumber} fora do intervalo do caderno.`, 400, 'INVALID_PAGE_NUMBERS');
    }
    if (!unique.includes(pageNumber)) unique.push(pageNumber);
  });

  return unique.sort((left, right) => left - right);
}

class ActivityThumbnailService {
  constructor({
    ActivityBookModel = ActivityBook,
    ActivityPageModel = ActivityPage,
    r2StorageServiceRef = r2StorageService,
    pdfjsImporter = async () => import('pdfjs-dist/legacy/build/pdf.mjs'),
    canvasFactory = createCanvas,
  } = {}) {
    this.ActivityBookModel = ActivityBookModel;
    this.ActivityPageModel = ActivityPageModel;
    this.r2StorageService = r2StorageServiceRef;
    this.pdfjsImporter = pdfjsImporter;
    this.canvasFactory = canvasFactory;
    this.pdfjsPromise = null;
    this.standardFontDataUrl = pathToFileURL(
      path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/')
    ).href;
  }

  async generateActivityBookThumbnails(bookId, options = {}) {
    const force = options.force === true || options.force === 'true';
    const book = await this.ActivityBookModel.findById(bookId).lean();
    if (!book || book.status === 'archived') {
      throw createHttpError('ActivityBook nao encontrado.', 404, 'BOOK_NOT_FOUND');
    }

    const pages = await this.ActivityPageModel.find({ bookId })
      .sort({ pageNumber: 1 })
      .lean();

    if (pages.length === 0) {
      throw createHttpError('Nenhuma pagina encontrada para este caderno.', 404, 'PAGES_NOT_FOUND');
    }

    const selectedPageNumbers = normalizePageList(options.pageNumbers, pages);
    const selectedPages = pages.filter((page) => selectedPageNumbers.includes(Number(page.pageNumber)));

    await this.ActivityBookModel.findByIdAndUpdate(bookId, {
      $set: {
        thumbnailsStatus: 'processing',
        thumbnailsError: '',
        thumbnailsTotal: pages.length,
      },
    });

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const items = [];
    let loadingTask = null;
    let pdfDocument = null;

    try {
      const pdfBuffer = await this.r2StorageService.downloadBuffer(book.originalPdfKey);
      const pdfjs = await this.getPdfjs();
      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(pdfBuffer),
        disableWorker: true,
        standardFontDataUrl: this.standardFontDataUrl,
      });

      pdfDocument = await loadingTask.promise;

      for (const page of selectedPages) {
        if (!force && page.thumbnailStatus === 'ready' && normalizeText(page.thumbnailKey)) {
          skipped += 1;
          items.push({
            pageId: String(page._id),
            pageNumber: page.pageNumber,
            thumbnailStatus: page.thumbnailStatus,
            thumbnailKey: page.thumbnailKey,
          });
          continue;
        }

        try {
          const result = await this.generateActivityPageThumbnail(book, page, pdfDocument, options);
          generated += 1;
          items.push(result);
        } catch (error) {
          failed += 1;
          const message = this.truncateError(error.message || 'Falha ao gerar thumbnail.');
          await this.markPageFailed(page, message);

          items.push({
            pageId: String(page._id),
            pageNumber: page.pageNumber,
            thumbnailStatus: 'failed',
            thumbnailKey: '',
            thumbnailError: message,
          });
        }
      }

      const counters = await this.refreshBookThumbnailCounters(bookId);

      return {
        bookId: String(bookId),
        status: counters.thumbnailsStatus,
        total: selectedPages.length,
        generated,
        skipped,
        failed,
        items,
      };
    } catch (error) {
      await this.ActivityBookModel.findByIdAndUpdate(bookId, {
        $set: {
          thumbnailsStatus: 'failed',
          thumbnailsError: this.truncateError(error.message || 'Falha ao gerar thumbnails.'),
        },
      }).catch(() => {});
      throw error;
    } finally {
      if (pdfDocument?.destroy) {
        await Promise.resolve(pdfDocument.destroy()).catch(() => {});
      }
      if (loadingTask?.destroy) {
        await Promise.resolve(loadingTask.destroy()).catch(() => {});
      }
    }
  }

  async generateActivityPageThumbnail(book, page, pdfDocument, options = {}) {
    const pdfPage = await pdfDocument.getPage(page.pageNumber);

    try {
      const rendered = await this.renderPdfPageToPng(pdfPage, options);
      const thumbnailKey = buildThumbnailKey(book._id, page.pageNumber, THUMBNAIL_EXTENSION);

      await this.r2StorageService.uploadBuffer({
        key: thumbnailKey,
        buffer: rendered.buffer,
        contentType: THUMBNAIL_CONTENT_TYPE,
      });

      await this.ActivityPageModel.findByIdAndUpdate(page._id, {
        $set: {
          thumbnailKey,
          thumbnailStatus: 'ready',
          thumbnailError: '',
          thumbnailGeneratedAt: new Date(),
          thumbnailContentType: THUMBNAIL_CONTENT_TYPE,
          thumbnailWidth: rendered.width,
          thumbnailHeight: rendered.height,
          thumbnailUrl: '',
        },
      });

      return {
        pageId: String(page._id),
        pageNumber: page.pageNumber,
        thumbnailStatus: 'ready',
        thumbnailKey,
      };
    } finally {
      pdfPage.cleanup();
    }
  }

  async renderPdfPageToPng(pdfPage, options = {}) {
    const targetWidth = Math.max(Number(options.targetWidth) || THUMBNAIL_TARGET_WIDTH, 120);
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    const scale = Math.max(1, targetWidth / baseViewport.width);
    const viewport = pdfPage.getViewport({ scale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = this.canvasFactory(width, height);
    const context = canvas.getContext('2d');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    await pdfPage.render({
      canvasContext: context,
      viewport,
    }).promise;

    const encoded = await canvas.encode(THUMBNAIL_EXTENSION);
    return {
      buffer: Buffer.from(encoded),
      width,
      height,
      contentType: THUMBNAIL_CONTENT_TYPE,
    };
  }

  async getSignedThumbnailUrl(thumbnailKey, expiresIn = THUMBNAIL_EXPIRES_IN_SECONDS) {
    const key = normalizeText(thumbnailKey);
    if (!key) return null;
    const result = await this.r2StorageService.getSignedDownloadUrl(key, expiresIn);
    return result.url || null;
  }

  async refreshBookThumbnailCounters(bookId) {
    const pages = await this.ActivityPageModel.find({ bookId })
      .select('thumbnailStatus')
      .lean();

    const thumbnailsTotal = pages.length;
    const thumbnailsReady = pages.filter((page) => page.thumbnailStatus === 'ready').length;
    const thumbnailsFailed = pages.filter((page) => page.thumbnailStatus === 'failed').length;

    let thumbnailsStatus = 'pending';
    if (thumbnailsTotal === 0) {
      thumbnailsStatus = 'pending';
    } else if (thumbnailsReady === thumbnailsTotal) {
      thumbnailsStatus = 'ready';
    } else if (thumbnailsReady > 0 && thumbnailsFailed > 0) {
      thumbnailsStatus = 'partial';
    } else if (thumbnailsFailed === thumbnailsTotal) {
      thumbnailsStatus = 'failed';
    } else if (thumbnailsReady > 0) {
      thumbnailsStatus = 'partial';
    } else if (thumbnailsFailed > 0) {
      thumbnailsStatus = 'partial';
    } else {
      thumbnailsStatus = 'processing';
    }

    const payload = {
      thumbnailsStatus,
      thumbnailsGeneratedAt: thumbnailsReady > 0 ? new Date() : null,
      thumbnailsTotal,
      thumbnailsReady,
      thumbnailsFailed,
      thumbnailsError: thumbnailsStatus === 'failed'
        ? 'Falha ao gerar thumbnails para todas as paginas.'
        : '',
    };

    const book = await this.ActivityBookModel.findByIdAndUpdate(
      bookId,
      { $set: payload },
      { new: true, runValidators: true }
    ).lean();

    return book;
  }

  async markPageFailed(page, message) {
    await this.ActivityPageModel.findByIdAndUpdate(page._id, {
      $set: {
        thumbnailKey: '',
        thumbnailStatus: 'failed',
        thumbnailError: message,
        thumbnailGeneratedAt: null,
        thumbnailContentType: '',
        thumbnailWidth: 0,
        thumbnailHeight: 0,
        thumbnailUrl: '',
      },
    });
  }

  truncateError(message) {
    const normalized = normalizeText(message);
    if (normalized.length <= THUMBNAIL_MAX_ERROR_LENGTH) return normalized;
    return `${normalized.slice(0, THUMBNAIL_MAX_ERROR_LENGTH - 3)}...`;
  }

  async getPdfjs() {
    if (!this.pdfjsPromise) {
      global.DOMMatrix = global.DOMMatrix || DOMMatrix;
      global.ImageData = global.ImageData || ImageData;
      global.Path2D = global.Path2D || Path2D;
      this.pdfjsPromise = this.pdfjsImporter();
    }

    return this.pdfjsPromise;
  }
}

module.exports = new ActivityThumbnailService();
module.exports.ActivityThumbnailService = ActivityThumbnailService;
module.exports.buildThumbnailKey = buildThumbnailKey;
module.exports.normalizePageList = normalizePageList;
