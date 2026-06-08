const path = require('node:path');

const { createCanvas, DOMMatrix, ImageData, Path2D, Image } = require('@napi-rs/canvas');

const ActivityBook = require('../models/activityBook.model');
const ActivityPage = require('../models/activityPage.model');
const r2StorageService = require('./r2Storage.service');

const THUMBNAIL_CONTENT_TYPE = 'image/png';
const THUMBNAIL_EXTENSION = 'png';
const THUMBNAIL_DEFAULT_WIDTH = 360;
const THUMBNAIL_MIN_WIDTH = 360;
const THUMBNAIL_MAX_WIDTH = 480;
const THUMBNAIL_EXPIRES_IN_SECONDS = 900;
const THUMBNAIL_MAX_ERROR_LENGTH = 240;
const THUMBNAIL_MAX_DETAIL_LENGTH = 300;
const DEFAULT_MAX_THUMBNAIL_PAGES_PER_REQUEST = 3;
const DEFAULT_PAGE_TIMEOUT_MS = 15000;
const RENDERER_SIGNATURE = 'pdfjs-dist@4.10.38 + @napi-rs/canvas';
const STAGE_R2_DOWNLOAD = 'r2-download';
const STAGE_PDF_LOAD = 'pdf-load';
const STAGE_GET_PAGE = 'get-page';
const STAGE_VIEWPORT = 'viewport';
const STAGE_CANVAS_CREATE = 'canvas-create';
const STAGE_RENDER = 'render';
const STAGE_CANVAS_ENCODE = 'canvas-encode';
const STAGE_R2_UPLOAD = 'r2-upload';
const STAGE_DB_UPDATE = 'db-update';
const STAGE_COMPLETED = 'completed';
const STAGE_BATCH = 'batch';

const KNOWN_ERROR_CODES = new Set([
  'R2_DOWNLOAD_FAILED',
  'PDF_LOAD_FAILED',
  'PDF_PAGE_NOT_FOUND',
  'PDF_RENDER_FAILED',
  'CANVAS_RENDER_FAILED',
  'THUMBNAIL_UPLOAD_FAILED',
  'THUMBNAIL_UPDATE_FAILED',
  'THUMBNAIL_BATCH_TOO_LARGE',
  'THUMBNAIL_TIMEOUT',
  'THUMBNAIL_DEBUG_SINGLE_PAGE_REQUIRED',
  'UNKNOWN_THUMBNAIL_ERROR',
  'BOOK_NOT_FOUND',
  'PAGES_NOT_FOUND',
  'INVALID_PAGE_NUMBERS',
  'INVALID_THUMBNAIL_BATCH_SIZE',
]);

function createHttpError(message, status = 400, code = 'ACTIVITY_THUMBNAIL_ERROR', details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function createStageError(
  message,
  code,
  stage,
  status = 500,
  details = {},
  originalError = null
) {
  const error = createHttpError(message, status, code, details);
  error.stage = stage;
  if (originalError) {
    attachOriginalErrorMetadata(error, originalError);
  }
  return error;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return defaultValue;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundDuration(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function getSafeErrorName(error) {
  const value = normalizeText(error?.originalName || error?.name || error?.constructor?.name || '');
  return value || null;
}

function getSafeErrorMessage(error, maxLength = THUMBNAIL_MAX_DETAIL_LENGTH) {
  const raw = normalizeText(error?.originalMessage || error?.message || '');
  if (!raw) return null;
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength - 3)}...`;
}

function getSafeErrorCode(error) {
  const value = normalizeText(error?.originalCode || error?.code || '');
  return value || null;
}

function getSafeErrorStack(error, maxLength = THUMBNAIL_MAX_DETAIL_LENGTH) {
  const raw = normalizeText(error?.originalStack || error?.stack || '');
  if (!raw) return null;
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength - 3)}...`;
}

function attachOriginalErrorMetadata(targetError, originalError) {
  if (!targetError || !originalError) return targetError;

  const originalName = getSafeErrorName(originalError);
  const originalMessage = getSafeErrorMessage(originalError);
  const originalCode = getSafeErrorCode(originalError);
  const originalStack = getSafeErrorStack(originalError);

  if (originalName) targetError.originalName = originalName;
  if (originalMessage) targetError.originalMessage = originalMessage;
  if (originalCode) targetError.originalCode = originalCode;
  if (originalStack) targetError.originalStack = originalStack;

  return targetError;
}

function getMaxThumbnailPagesPerRequest() {
  const parsed = parsePositiveInteger(process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST);
  return parsed || DEFAULT_MAX_THUMBNAIL_PAGES_PER_REQUEST;
}

function getThumbnailTargetWidth(rawWidth) {
  const parsed = parsePositiveInteger(rawWidth);
  return clamp(parsed || THUMBNAIL_DEFAULT_WIDTH, THUMBNAIL_MIN_WIDTH, THUMBNAIL_MAX_WIDTH);
}

function getThumbnailPageTimeoutMs() {
  const parsed = parsePositiveInteger(process.env.THUMBNAIL_PAGE_TIMEOUT_MS);
  return parsed || DEFAULT_PAGE_TIMEOUT_MS;
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

  if (pageNumbers === undefined || pageNumbers === null) {
    return [...availablePageNumbers].sort((left, right) => left - right);
  }

  const values = Array.isArray(pageNumbers) ? pageNumbers : [pageNumbers];
  const unique = [];

  values.forEach((value) => {
    const pageNumber = Number(value);
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
      throw createHttpError('pageNumbers precisa conter inteiros positivos.', 400, 'INVALID_PAGE_NUMBERS');
    }
    if (availablePageNumbers.length > 0 && !availablePageNumbers.includes(pageNumber)) {
      throw createHttpError(`Pagina ${pageNumber} nao encontrada neste caderno.`, 400, 'INVALID_PAGE_NUMBERS');
    }
    if (!unique.includes(pageNumber)) unique.push(pageNumber);
  });

  return unique.sort((left, right) => left - right);
}

function getMemorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rssMB: Math.round((usage.rss / (1024 * 1024)) * 10) / 10,
    heapUsedMB: Math.round((usage.heapUsed / (1024 * 1024)) * 10) / 10,
  };
}

function formatLogFields(fields = {}) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, '_')}`)
    .join(' ');
}

function byPageNumber(left, right) {
  return Number(left.pageNumber) - Number(right.pageNumber);
}

function byPendingThenFailed(left, right) {
  const leftReady = left.thumbnailStatus === 'ready' && normalizeText(left.thumbnailKey);
  const rightReady = right.thumbnailStatus === 'ready' && normalizeText(right.thumbnailKey);
  if (leftReady === rightReady) {
    const leftFailed = left.thumbnailStatus === 'failed';
    const rightFailed = right.thumbnailStatus === 'failed';
    if (leftFailed !== rightFailed) return leftFailed ? 1 : -1;
    return byPageNumber(left, right);
  }
  return leftReady ? 1 : -1;
}

function byOldestAttempt(left, right) {
  const leftAttempt = left.thumbnailLastAttemptAt ? new Date(left.thumbnailLastAttemptAt).getTime() : null;
  const rightAttempt = right.thumbnailLastAttemptAt ? new Date(right.thumbnailLastAttemptAt).getTime() : null;

  if (leftAttempt === null && rightAttempt === null) return byPageNumber(left, right);
  if (leftAttempt === null) return -1;
  if (rightAttempt === null) return 1;
  if (leftAttempt !== rightAttempt) return leftAttempt - rightAttempt;
  return byPageNumber(left, right);
}

function getAutomaticEligiblePages(pages, force = false) {
  const normalizedPages = Array.isArray(pages) ? pages.slice() : [];

  if (force) {
    return normalizedPages.sort(byOldestAttempt);
  }

  return normalizedPages
    .filter((page) => !(page.thumbnailStatus === 'ready' && normalizeText(page.thumbnailKey)))
    .sort(byPendingThenFailed);
}

function getBatchPlan(pages, options = {}) {
  const maxBatchSize = getMaxThumbnailPagesPerRequest();
  const debug = toBoolean(options.debug, false);
  const requestedBatchSize = parsePositiveInteger(options.batchSize);
  const batchSize = requestedBatchSize || (debug ? 1 : maxBatchSize);

  if (batchSize > maxBatchSize) {
    throw createHttpError(
      `Para evitar estouro de memoria, gere no maximo ${maxBatchSize} thumbnails por requisicao.`,
      400,
      'THUMBNAIL_BATCH_TOO_LARGE',
      {
        maxBatchSize,
        received: batchSize,
      }
    );
  }

  if (debug && requestedBatchSize && batchSize > 1) {
    throw createHttpError(
      'No modo debug, gere apenas 1 thumbnail por requisicao.',
      400,
      'THUMBNAIL_DEBUG_SINGLE_PAGE_REQUIRED',
      {
        maxDebugPages: 1,
        received: batchSize,
      }
    );
  }

  const force = toBoolean(options.force, false);
  const hasExplicitPageNumbers = options.pageNumbers !== undefined && options.pageNumbers !== null;
  let selectedPages = [];

  if (hasExplicitPageNumbers) {
    const selectedPageNumbers = normalizePageList(options.pageNumbers, pages);
    if (selectedPageNumbers.length > maxBatchSize) {
      throw createHttpError(
        `Para evitar estouro de memoria, gere no maximo ${maxBatchSize} thumbnails por requisicao.`,
        400,
        'THUMBNAIL_BATCH_TOO_LARGE',
        {
          maxBatchSize,
          received: selectedPageNumbers.length,
        }
      );
    }

    if (debug && selectedPageNumbers.length > 1) {
      throw createHttpError(
        'No modo debug, gere apenas 1 thumbnail por requisicao.',
        400,
        'THUMBNAIL_DEBUG_SINGLE_PAGE_REQUIRED',
        {
          maxDebugPages: 1,
          received: selectedPageNumbers.length,
        }
      );
    }

    selectedPages = pages.filter((page) => selectedPageNumbers.includes(Number(page.pageNumber)));
  } else {
    const eligiblePages = getAutomaticEligiblePages(pages, force);
    selectedPages = eligiblePages.slice(0, debug ? 1 : batchSize);
  }

  return {
    force,
    debug,
    batchSize,
    maxBatchSize,
    hasExplicitPageNumbers,
    selectedPages: selectedPages.sort(byPageNumber),
    processedPageNumbers: selectedPages.map((page) => Number(page.pageNumber)),
  };
}

function buildTimingSummary({ startedAt, finishedAt, processed, remaining }) {
  const durationMs = roundDuration(finishedAt.getTime() - startedAt.getTime());
  const averagePerPageMs = processed > 0 ? roundDuration(durationMs / processed) : null;
  const estimatedRemainingMs = averagePerPageMs !== null ? roundDuration(remaining * averagePerPageMs) : null;

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    averagePerPageMs,
    estimatedRemainingMs,
  };
}

class ActivityThumbnailService {
  constructor({
    ActivityBookModel = ActivityBook,
    ActivityPageModel = ActivityPage,
    r2StorageServiceRef = r2StorageService,
    pdfjsImporter = async () => import('pdfjs-dist/legacy/build/pdf.mjs'),
    canvasFactory = createCanvas,
    logger = console,
    now = () => new Date(),
  } = {}) {
    this.ActivityBookModel = ActivityBookModel;
    this.ActivityPageModel = ActivityPageModel;
    this.r2StorageService = r2StorageServiceRef;
    this.pdfjsImporter = pdfjsImporter;
    this.canvasFactory = canvasFactory;
    this.logger = logger;
    this.now = now;
    this.pdfjsPromise = null;
    this.standardFontDataDir = this.ensureDirectorySuffix(
      path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts')
    );
    this.cMapDir = this.ensureDirectorySuffix(
      path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps')
    );
  }

  async generateActivityBookThumbnails(bookId, options = {}) {
    const startedAt = this.now();
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

    const plan = getBatchPlan(pages, options);
    const selectedPages = plan.selectedPages;

    await this.ActivityBookModel.findByIdAndUpdate(bookId, {
      $set: {
        thumbnailsStatus: 'processing',
        thumbnailsError: '',
        thumbnailsTotal: pages.length,
      },
    });

    this.logBatchEvent(bookId, STAGE_BATCH, 'started', {
      processed: selectedPages.length,
      maxBatchSize: plan.maxBatchSize,
      batchSize: plan.batchSize,
      force: plan.force,
      debug: plan.debug,
      rssMB: getMemorySnapshot().rssMB,
      heapUsedMB: getMemorySnapshot().heapUsedMB,
    });

    if (selectedPages.length === 0) {
      const counters = await this.refreshBookThumbnailCounters(bookId);
      const finishedAt = this.now();
      const remainingState = this.computeRemainingState(pages, plan.force, plan.batchSize);

      return {
        bookId: String(bookId),
        status: counters.thumbnailsStatus,
        total: pages.length,
        generated: 0,
        skipped: 0,
        failed: 0,
        processed: 0,
        processedPageNumbers: [],
        hasMore: remainingState.hasMore,
        remaining: remainingState.remaining,
        nextRecommendedPageNumbers: remainingState.nextRecommendedPageNumbers,
        timing: buildTimingSummary({
          startedAt,
          finishedAt,
          processed: 0,
          remaining: remainingState.remaining,
        }),
        items: [],
      };
    }

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const items = [];
    let loadingTask = null;
    let pdfDocument = null;
    let pdfBuffer = null;

    try {
      try {
        pdfBuffer = await this.r2StorageService.downloadBuffer(book.originalPdfKey);
      } catch (error) {
        throw createStageError(
          'Falha ao baixar o PDF original do R2.',
          'R2_DOWNLOAD_FAILED',
          STAGE_R2_DOWNLOAD,
          502,
          {},
          error
        );
      }

      try {
        const pdfjs = await this.getPdfjs();
        loadingTask = pdfjs.getDocument({
          data: new Uint8Array(pdfBuffer),
          disableWorker: true,
          standardFontDataUrl: this.standardFontDataDir,
          cMapUrl: this.cMapDir,
          cMapPacked: true,
          useSystemFonts: false,
          isEvalSupported: false,
        });
        pdfDocument = await loadingTask.promise;
      } catch (error) {
        throw createStageError(
          'Falha ao carregar o PDF para gerar thumbnails.',
          'PDF_LOAD_FAILED',
          STAGE_PDF_LOAD,
          502,
          {},
          error
        );
      } finally {
        pdfBuffer = null;
      }

      for (const page of selectedPages) {
        const pageStartedAt = this.now();

        if (!plan.force && page.thumbnailStatus === 'ready' && normalizeText(page.thumbnailKey)) {
          skipped += 1;
          const durationMs = roundDuration(this.now().getTime() - pageStartedAt.getTime());
          items.push({
            pageId: String(page._id),
            pageNumber: page.pageNumber,
            thumbnailStatus: 'ready',
            thumbnailKey: page.thumbnailKey,
            thumbnailUrl: null,
            durationMs,
            errorCode: null,
            errorMessage: null,
            stage: STAGE_COMPLETED,
            debug: null,
          });

          this.logPageEvent(bookId, page.pageNumber, STAGE_COMPLETED, 'skipped', durationMs);
          continue;
        }

        try {
          const result = await this.generateActivityPageThumbnail(book, page, pdfDocument, options, pageStartedAt);
          generated += 1;
          items.push(result);
        } catch (error) {
          failed += 1;
          let classifiedError = this.classifyPageError(error);

          try {
            await this.markPageFailed(page, classifiedError);
          } catch (updateError) {
            classifiedError = this.classifyPageError(updateError);
          }

          const durationMs = roundDuration(this.now().getTime() - pageStartedAt.getTime());
          items.push({
            pageId: String(page._id),
            pageNumber: page.pageNumber,
            thumbnailStatus: 'failed',
            thumbnailKey: null,
            thumbnailUrl: null,
            durationMs,
            errorCode: classifiedError.code,
            errorMessage: this.truncateError(classifiedError.message || 'Falha ao gerar thumbnail.'),
            stage: classifiedError.stage || STAGE_BATCH,
            debug: plan.debug ? this.buildDebugPayload(classifiedError) : null,
          });

          this.logPageEvent(
            bookId,
            page.pageNumber,
            classifiedError.stage || STAGE_BATCH,
            'failed',
            durationMs,
            classifiedError.code,
            classifiedError.message,
            classifiedError
          );
        }
      }

      const counters = await this.refreshBookThumbnailCounters(bookId);
      const finishedAt = this.now();
      const updatedPages = await this.ActivityPageModel.find({ bookId })
        .sort({ pageNumber: 1 })
        .lean();
      const remainingState = this.computeRemainingState(updatedPages, plan.force, plan.batchSize);

      this.logBatchEvent(bookId, STAGE_BATCH, 'completed', {
        processed: selectedPages.length,
        generated,
        skipped,
        failed,
        durationMs: roundDuration(finishedAt.getTime() - startedAt.getTime()),
        rssMB: getMemorySnapshot().rssMB,
        heapUsedMB: getMemorySnapshot().heapUsedMB,
      });

      return {
        bookId: String(bookId),
        status: counters.thumbnailsStatus,
        total: updatedPages.length,
        generated,
        skipped,
        failed,
        processed: selectedPages.length,
        processedPageNumbers: plan.processedPageNumbers,
        hasMore: remainingState.hasMore,
        remaining: remainingState.remaining,
        nextRecommendedPageNumbers: remainingState.nextRecommendedPageNumbers,
        timing: buildTimingSummary({
          startedAt,
          finishedAt,
          processed: selectedPages.length,
          remaining: remainingState.remaining,
        }),
        items,
      };
    } catch (error) {
      const classifiedError = this.classifyBatchError(error);
      await this.ActivityBookModel.findByIdAndUpdate(bookId, {
        $set: {
          thumbnailsStatus: 'failed',
          thumbnailsError: this.truncateError(classifiedError.message || 'Falha ao gerar thumbnails.'),
        },
      }).catch(() => {});

      this.logBatchEvent(bookId, classifiedError.stage || STAGE_BATCH, 'failed', {
        code: classifiedError.code,
        message: this.truncateError(classifiedError.message),
        originalName: classifiedError.originalName,
        originalCode: classifiedError.originalCode,
        originalMessage: classifiedError.originalMessage,
        originalStack: classifiedError.originalStack,
        durationMs: roundDuration(this.now().getTime() - startedAt.getTime()),
        rssMB: getMemorySnapshot().rssMB,
        heapUsedMB: getMemorySnapshot().heapUsedMB,
      });

      throw classifiedError;
    } finally {
      pdfBuffer = null;

      if (pdfDocument?.destroy) {
        await Promise.resolve(pdfDocument.destroy()).catch(() => {});
      }
      if (loadingTask?.destroy) {
        await Promise.resolve(loadingTask.destroy()).catch(() => {});
      }

      pdfDocument = null;
      loadingTask = null;
    }
  }

  async generateActivityPageThumbnail(book, page, pdfDocument, options = {}, startedAt = this.now()) {
    let pdfPage = null;

    try {
      try {
        pdfPage = await pdfDocument.getPage(page.pageNumber);
      } catch (error) {
        throw createStageError(
          'A pagina solicitada nao existe no PDF original.',
          'PDF_PAGE_NOT_FOUND',
          STAGE_GET_PAGE,
          404,
          {},
          error
        );
      }

      const rendered = await this.renderPdfPageToPng(pdfPage, options);
      const thumbnailKey = buildThumbnailKey(book._id, page.pageNumber, THUMBNAIL_EXTENSION);

      try {
        await this.r2StorageService.uploadBuffer({
          key: thumbnailKey,
          buffer: rendered.buffer,
          contentType: THUMBNAIL_CONTENT_TYPE,
        });
      } catch (error) {
        throw createStageError(
          'A imagem foi gerada, mas falhou ao salvar no R2.',
          'THUMBNAIL_UPLOAD_FAILED',
          STAGE_R2_UPLOAD,
          502,
          {},
          error
        );
      } finally {
        rendered.buffer = null;
      }

      try {
        await this.ActivityPageModel.findByIdAndUpdate(page._id, {
          $set: {
            thumbnailKey,
            thumbnailStatus: 'ready',
            thumbnailError: '',
            thumbnailErrorCode: '',
            thumbnailErrorStage: '',
            thumbnailLastAttemptAt: this.now(),
            thumbnailGeneratedAt: this.now(),
            thumbnailContentType: THUMBNAIL_CONTENT_TYPE,
            thumbnailWidth: rendered.width,
            thumbnailHeight: rendered.height,
            thumbnailUrl: '',
          },
        });
      } catch (error) {
        throw createStageError(
          'A thumbnail foi gerada, mas falhou ao atualizar o status no banco.',
          'THUMBNAIL_UPDATE_FAILED',
          STAGE_DB_UPDATE,
          500,
          {},
          error
        );
      }

      const durationMs = roundDuration(this.now().getTime() - startedAt.getTime());
      this.logPageEvent(book._id, page.pageNumber, STAGE_COMPLETED, 'ready', durationMs);

      return {
        pageId: String(page._id),
        pageNumber: page.pageNumber,
        thumbnailStatus: 'ready',
        thumbnailKey,
        thumbnailUrl: null,
        durationMs,
        errorCode: null,
        errorMessage: null,
        stage: STAGE_COMPLETED,
        debug: null,
      };
    } finally {
      if (pdfPage?.cleanup) {
        try {
          pdfPage.cleanup();
        } catch (error) {
          // noop
        }
      }
      pdfPage = null;
    }
  }

  async renderPdfPageToPng(pdfPage, options = {}) {
    const targetWidth = getThumbnailTargetWidth(options.targetWidth);
    const timeoutMs = parsePositiveInteger(options.timeoutMs) || getThumbnailPageTimeoutMs();
    let baseViewport = null;
    let viewport = null;
    let width = 0;
    let height = 0;

    try {
      baseViewport = pdfPage.getViewport({ scale: 1 });
      const scale = targetWidth / Math.max(baseViewport.width || targetWidth, 1);
      viewport = pdfPage.getViewport({ scale });
      width = Math.max(1, Math.ceil(viewport.width));
      height = Math.max(1, Math.ceil(viewport.height));
    } catch (error) {
      throw createStageError(
        'Falha ao calcular a viewport da thumbnail.',
        'PDF_RENDER_FAILED',
        STAGE_VIEWPORT,
        502,
        {},
        error
      );
    }

    let canvas = null;
    let context = null;
    let renderTask = null;
    let timeoutHandle = null;

    try {
      try {
        canvas = this.canvasFactory(width, height);
        context = canvas.getContext('2d');
      } catch (error) {
        throw createStageError(
          'Falha ao preparar o canvas da thumbnail.',
          'CANVAS_RENDER_FAILED',
          STAGE_CANVAS_CREATE,
          500,
          {},
          error
        );
      }

      if (!context) {
        throw createStageError(
          'Falha ao obter contexto 2D do canvas da thumbnail.',
          'CANVAS_RENDER_FAILED',
          STAGE_CANVAS_CREATE,
          500
        );
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);

      try {
        renderTask = pdfPage.render({
          canvasContext: context,
          viewport,
        });

        await Promise.race([
          renderTask.promise,
          new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
              try {
                renderTask?.cancel?.();
              } catch (error) {
                // noop
              }

              reject(createStageError(
                `Timeout ao renderizar a pagina ${pdfPage.pageNumber || ''} do PDF.`,
                'THUMBNAIL_TIMEOUT',
                STAGE_RENDER,
                504
              ));
            }, timeoutMs);
          }),
        ]);
      } catch (error) {
        if (error?.code === 'THUMBNAIL_TIMEOUT') throw error;
        throw createStageError(
          'O renderizador nao conseguiu converter esta pagina em imagem.',
          'PDF_RENDER_FAILED',
          STAGE_RENDER,
          502,
          {},
          error
        );
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }

      try {
        const encoded = await canvas.encode(THUMBNAIL_EXTENSION);
        return {
          buffer: Buffer.from(encoded),
          width,
          height,
          contentType: THUMBNAIL_CONTENT_TYPE,
        };
      } catch (error) {
        throw createStageError(
          'Falha ao codificar a imagem da thumbnail.',
          'CANVAS_RENDER_FAILED',
          STAGE_CANVAS_ENCODE,
          500,
          {},
          error
        );
      }
    } finally {
      if (renderTask?.cancel) {
        try {
          renderTask.cancel();
        } catch (error) {
          // noop
        }
      }

      if (context?.clearRect) {
        try {
          context.clearRect(0, 0, width, height);
        } catch (error) {
          // noop
        }
      }

      if (canvas) {
        try {
          canvas.width = 0;
          canvas.height = 0;
        } catch (error) {
          // noop
        }
      }

      renderTask = null;
      context = null;
      canvas = null;
      timeoutHandle = null;
    }
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
    if (thumbnailsTotal === 0 || (thumbnailsReady === 0 && thumbnailsFailed === 0)) {
      thumbnailsStatus = 'pending';
    } else if (thumbnailsReady === thumbnailsTotal) {
      thumbnailsStatus = 'ready';
    } else if (thumbnailsFailed === thumbnailsTotal) {
      thumbnailsStatus = 'failed';
    } else {
      thumbnailsStatus = 'partial';
    }

    const payload = {
      thumbnailsStatus,
      thumbnailsGeneratedAt: thumbnailsReady > 0 ? this.now() : null,
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

  async markPageFailed(page, error) {
    const classifiedError = this.classifyPageError(error);

    try {
      await this.ActivityPageModel.findByIdAndUpdate(page._id, {
        $set: {
          thumbnailKey: '',
          thumbnailStatus: 'failed',
          thumbnailError: this.truncateError(classifiedError.message || 'Falha ao gerar thumbnail.'),
          thumbnailErrorCode: classifiedError.code || 'UNKNOWN_THUMBNAIL_ERROR',
          thumbnailErrorStage: classifiedError.stage || STAGE_BATCH,
          thumbnailLastAttemptAt: this.now(),
          thumbnailGeneratedAt: null,
          thumbnailContentType: '',
          thumbnailWidth: 0,
          thumbnailHeight: 0,
          thumbnailUrl: '',
        },
      });
    } catch (updateError) {
      throw createStageError(
        `Falha ao atualizar o status de erro da pagina ${page.pageNumber}.`,
        'THUMBNAIL_UPDATE_FAILED',
        STAGE_DB_UPDATE,
        500,
        {},
        updateError
      );
    }
  }

  truncateError(message) {
    const normalized = normalizeText(message);
    if (normalized.length <= THUMBNAIL_MAX_ERROR_LENGTH) return normalized;
    return `${normalized.slice(0, THUMBNAIL_MAX_ERROR_LENGTH - 3)}...`;
  }

  classifyPageError(error) {
    if (!error) {
      return createStageError(
        'Falha desconhecida ao gerar thumbnail.',
        'UNKNOWN_THUMBNAIL_ERROR',
        STAGE_BATCH,
        500
      );
    }

    if (KNOWN_ERROR_CODES.has(error.code)) {
      return error;
    }

    return attachOriginalErrorMetadata(createStageError(
      this.truncateError(error.message || 'Falha desconhecida ao gerar thumbnail.'),
      'UNKNOWN_THUMBNAIL_ERROR',
      error.stage || STAGE_BATCH,
      error.status || 500
    ), error);
  }

  classifyBatchError(error) {
    if (!error) {
      return createStageError('Falha ao gerar thumbnails.', 'UNKNOWN_THUMBNAIL_ERROR', STAGE_BATCH, 500);
    }

    if (KNOWN_ERROR_CODES.has(error.code)) return error;

    return attachOriginalErrorMetadata(createStageError(
      this.truncateError(error.message || 'Falha ao gerar thumbnails.'),
      error.code || 'UNKNOWN_THUMBNAIL_ERROR',
      error.stage || STAGE_BATCH,
      error.status || 500,
      error.details || {}
    ), error);
  }

  computeRemainingState(pages, force, batchSize) {
    const eligiblePages = getAutomaticEligiblePages(pages, force);
    const nextRecommendedPages = eligiblePages.slice(0, batchSize).map((page) => Number(page.pageNumber));

    return {
      hasMore: eligiblePages.length > 0,
      remaining: eligiblePages.length,
      nextRecommendedPageNumbers: nextRecommendedPages,
    };
  }

  logBatchEvent(bookId, stage, status, details = {}) {
    const memory = getMemorySnapshot();
    this.logger.info(
      `[activity-thumbnails] ${formatLogFields({
        book: String(bookId),
        stage,
        status,
        durationMs: details.durationMs,
        processed: details.processed,
        generated: details.generated,
        skipped: details.skipped,
        failed: details.failed,
        force: details.force,
        batchSize: details.batchSize,
        maxBatchSize: details.maxBatchSize,
        debug: details.debug,
        code: details.code,
        errorMessage: details.message,
        originalName: details.originalName,
        originalCode: details.originalCode,
        originalMessage: this.truncateError(details.originalMessage || ''),
        originalStack: this.truncateError(details.originalStack || ''),
        rssMB: details.rssMB ?? memory.rssMB,
        heapUsedMB: details.heapUsedMB ?? memory.heapUsedMB,
      })}`
    );
  }

  logPageEvent(
    bookId,
    pageNumber,
    stage,
    status,
    durationMs,
    errorCode = null,
    errorMessage = null,
    originalError = null
  ) {
    const memory = getMemorySnapshot();
    const originalName = getSafeErrorName(originalError);
    const originalCode = getSafeErrorCode(originalError);
    const originalMessage = getSafeErrorMessage(originalError);
    const originalStack = getSafeErrorStack(originalError);
    this.logger.info(
      `[activity-thumbnails] ${formatLogFields({
        book: String(bookId),
        page: pageNumber,
        stage,
        status,
        code: errorCode,
        errorMessage: this.truncateError(errorMessage || ''),
        originalName,
        originalCode,
        originalMessage: this.truncateError(originalMessage || ''),
        originalStack: this.truncateError(originalStack || ''),
        durationMs,
        rssMB: memory.rssMB,
        heapUsedMB: memory.heapUsedMB,
      })}`
    );
  }

  async getPdfjs() {
    if (!this.pdfjsPromise) {
      global.DOMMatrix = global.DOMMatrix || DOMMatrix;
      global.ImageData = global.ImageData || ImageData;
      global.Path2D = global.Path2D || Path2D;
      global.Image = global.Image || Image;
      this.pdfjsPromise = this.pdfjsImporter();
    }

    return this.pdfjsPromise;
  }

  ensureDirectorySuffix(dirPath) {
    const normalized = path.resolve(dirPath);
    return normalized.endsWith(path.sep) ? normalized : `${normalized}${path.sep}`;
  }

  buildDebugPayload(error) {
    const originalName = getSafeErrorName(error);
    const originalCode = getSafeErrorCode(error);
    const originalMessage = getSafeErrorMessage(error);
    const detail = getSafeErrorMessage(error, THUMBNAIL_MAX_DETAIL_LENGTH);

    if (!originalName && !originalCode && !originalMessage && !detail) {
      return null;
    }

    return {
      originalName,
      originalCode,
      originalMessage,
      detail,
      renderer: RENDERER_SIGNATURE,
    };
  }
}

module.exports = new ActivityThumbnailService();
module.exports.ActivityThumbnailService = ActivityThumbnailService;
module.exports.buildThumbnailKey = buildThumbnailKey;
module.exports.normalizePageList = normalizePageList;
module.exports.getMaxThumbnailPagesPerRequest = getMaxThumbnailPagesPerRequest;
module.exports.getBatchPlan = getBatchPlan;
