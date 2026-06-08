const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  ActivityThumbnailService,
  buildThumbnailKey,
  normalizePageList,
  getBatchPlan,
} = require('../../api/services/activityThumbnail.service');

function createQuery(value) {
  return {
    select() { return this; },
    sort() { return this; },
    lean() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function createHarness(overrides = {}) {
  const bookId = new mongoose.Types.ObjectId();
  const pageIds = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());
  let tick = 0;
  const logs = [];

  const state = {
    book: {
      _id: bookId,
      originalPdfKey: 'platform/activity-books/book/original.pdf',
      status: 'ready',
      thumbnailsStatus: 'pending',
      thumbnailsTotal: 0,
      thumbnailsReady: 0,
      thumbnailsFailed: 0,
      thumbnailsError: '',
      ...(overrides.book || {}),
    },
    pages: [
      {
        _id: pageIds[0],
        bookId,
        pageNumber: 1,
        thumbnailKey: '',
        thumbnailStatus: 'pending',
        thumbnailError: '',
        thumbnailLastAttemptAt: null,
      },
      {
        _id: pageIds[1],
        bookId,
        pageNumber: 2,
        thumbnailKey: '',
        thumbnailStatus: 'pending',
        thumbnailError: '',
        thumbnailLastAttemptAt: null,
      },
      {
        _id: pageIds[2],
        bookId,
        pageNumber: 3,
        thumbnailKey: '',
        thumbnailStatus: 'pending',
        thumbnailError: '',
        thumbnailLastAttemptAt: null,
      },
      {
        _id: pageIds[3],
        bookId,
        pageNumber: 4,
        thumbnailKey: '',
        thumbnailStatus: 'failed',
        thumbnailError: 'Falha anterior',
        thumbnailErrorCode: 'PDF_RENDER_FAILED',
        thumbnailErrorStage: 'render',
        thumbnailLastAttemptAt: new Date('2026-06-07T00:00:00.000Z'),
      },
      {
        _id: pageIds[4],
        bookId,
        pageNumber: 5,
        thumbnailKey: 'platform/activity-books/book/thumbnails/page-005.png',
        thumbnailStatus: 'ready',
        thumbnailError: '',
        thumbnailLastAttemptAt: new Date('2026-06-07T00:00:10.000Z'),
      },
    ].map((page, index) => ({ ...page, ...(overrides.pages?.[index] || {}) })),
    uploads: [],
    renderCalls: [],
    pdfPageCalls: [],
  };

  const fakePdfDocument = {
    async getPage(pageNumber) {
      state.pdfPageCalls.push(pageNumber);
      if (overrides.pageErrors?.[pageNumber]) {
        throw overrides.pageErrors[pageNumber];
      }
      return {
        pageNumber,
        cleanup() {},
      };
    },
    destroy() {},
  };

  const fakeLoadingTask = {
    promise: overrides.loadingPromiseError
      ? Promise.reject(overrides.loadingPromiseError)
      : Promise.resolve(fakePdfDocument),
    destroy() {},
  };

  const service = new ActivityThumbnailService({
    ActivityBookModel: {
      findById(id) {
        return createQuery(String(id) === String(bookId) ? state.book : null);
      },
      findByIdAndUpdate(id, update = {}, options = {}) {
        if (String(id) !== String(bookId)) return createQuery(null);
        Object.assign(state.book, update.$set || {});
        if (options?.new) return createQuery({ ...state.book });
        return Promise.resolve({ ...state.book });
      },
    },
    ActivityPageModel: {
      find(filter = {}) {
        const items = state.pages
          .filter((page) => !filter.bookId || String(page.bookId) === String(filter.bookId))
          .map((page) => ({ ...page }));
        return createQuery(items);
      },
      findByIdAndUpdate(id, update = {}) {
        const page = state.pages.find((item) => String(item._id) === String(id));
        if (!page) return Promise.resolve(null);
        Object.assign(page, update.$set || {});
        return Promise.resolve({ ...page });
      },
    },
    r2StorageServiceRef: {
      async downloadBuffer() {
        if (overrides.downloadError) throw overrides.downloadError;
        return Buffer.from('%PDF-test');
      },
      async uploadBuffer(input) {
        if (overrides.uploadError) throw overrides.uploadError;
        state.uploads.push(input);
        return { key: input.key };
      },
      async getSignedDownloadUrl(key) {
        return { key, url: `https://signed.example/${encodeURIComponent(key)}` };
      },
    },
    pdfjsImporter: async () => ({
      getDocument() {
        if (overrides.loadingTaskError) {
          throw overrides.loadingTaskError;
        }
        return fakeLoadingTask;
      },
    }),
    logger: {
      info(message) {
        logs.push(message);
      },
    },
    now: () => new Date(Date.UTC(2026, 5, 7, 0, 0, 0, tick++ * 100)),
  });

  service.renderPdfPageToPng = async (pdfPage) => {
    state.renderCalls.push(pdfPage.pageNumber);
    if (overrides.renderErrors?.[pdfPage.pageNumber]) {
      throw overrides.renderErrors[pdfPage.pageNumber];
    }
    return {
      buffer: Buffer.from(`png-${pdfPage.pageNumber}`),
      width: 360,
      height: 480,
      contentType: 'image/png',
    };
  };

  return {
    service,
    state,
    logs,
    ids: {
      bookId: String(bookId),
      pageIds: pageIds.map(String),
    },
  };
}

test('buildThumbnailKey zero-pads page numbers', () => {
  assert.equal(
    buildThumbnailKey('book123', 7),
    'platform/activity-books/book123/thumbnails/page-007.png'
  );
});

test('normalizePageList normalizes, deduplicates and sorts page numbers', () => {
  const pages = [{ pageNumber: 3 }, { pageNumber: 1 }, { pageNumber: 2 }];
  assert.deepEqual(normalizePageList([3, '1', 3, 2], pages), [1, 2, 3]);
});

test('getBatchPlan rejects pageNumbers larger than hard limit', () => {
  const pages = [1, 2, 3, 4].map((pageNumber) => ({ pageNumber }));
  const originalEnv = process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST;
  process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST = '3';

  try {
    assert.throws(
      () => getBatchPlan(pages, { pageNumbers: [1, 2, 3, 4] }),
      (error) => error.code === 'THUMBNAIL_BATCH_TOO_LARGE'
        && error.details.maxBatchSize === 3
        && error.details.received === 4
    );
  } finally {
    if (originalEnv === undefined) delete process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST;
    else process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST = originalEnv;
  }
});

test('generateActivityBookThumbnails rejects batchSize larger than hard limit', async () => {
  const harness = createHarness();
  const originalEnv = process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST;
  process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST = '3';

  try {
    await assert.rejects(
      () => harness.service.generateActivityBookThumbnails(harness.ids.bookId, { batchSize: 4 }),
      (error) => error.code === 'THUMBNAIL_BATCH_TOO_LARGE'
        && error.details.maxBatchSize === 3
        && error.details.received === 4
    );
  } finally {
    if (originalEnv === undefined) delete process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST;
    else process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST = originalEnv;
  }
});

test('generateActivityBookThumbnails without pageNumbers processes only the next safe batch', async () => {
  const harness = createHarness();
  const originalEnv = process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST;
  process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST = '3';

  try {
    const result = await harness.service.generateActivityBookThumbnails(harness.ids.bookId, {
      force: false,
      batchSize: 3,
    });

    assert.equal(result.total, 5);
    assert.equal(result.processed, 3);
    assert.deepEqual(result.processedPageNumbers, [1, 2, 3]);
    assert.equal(result.generated, 3);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed, 0);
    assert.equal(result.hasMore, true);
    assert.equal(result.remaining, 1);
    assert.deepEqual(result.nextRecommendedPageNumbers, [4]);
    assert.equal(typeof result.timing.durationMs, 'number');
    assert.equal(typeof result.timing.averagePerPageMs, 'number');
    assert.equal(typeof result.timing.estimatedRemainingMs, 'number');
  } finally {
    if (originalEnv === undefined) delete process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST;
    else process.env.MAX_THUMBNAIL_PAGES_PER_REQUEST = originalEnv;
  }
});

test('generateActivityBookThumbnails in debug mode rejects more than one page', async () => {
  const harness = createHarness();

  await assert.rejects(
    () => harness.service.generateActivityBookThumbnails(harness.ids.bookId, {
      force: true,
      debug: true,
      pageNumbers: [1, 2],
    }),
    (error) => error.code === 'THUMBNAIL_DEBUG_SINGLE_PAGE_REQUIRED'
      && error.details.maxDebugPages === 1
      && error.details.received === 2
  );
});

test('generateActivityBookThumbnails skips ready pages when force=false and pageNumbers are explicit', async () => {
  const harness = createHarness();

  const result = await harness.service.generateActivityBookThumbnails(harness.ids.bookId, {
    force: false,
    pageNumbers: [5, 4],
  });

  assert.equal(result.processed, 2);
  assert.equal(result.generated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(harness.state.renderCalls, [4]);
});

test('generateActivityBookThumbnails regenerates explicit pages when force=true', async () => {
  const harness = createHarness();

  const result = await harness.service.generateActivityBookThumbnails(harness.ids.bookId, {
    force: true,
    pageNumbers: [4, 5],
  });

  assert.equal(result.processed, 2);
  assert.equal(result.generated, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.deepEqual(harness.state.renderCalls, [4, 5]);
});

test('generateActivityBookThumbnails includes per-page error details and persists error code/stage', async () => {
  const harness = createHarness({
    pageErrors: {
      2: new Error('Pagina ausente'),
    },
  });

  const result = await harness.service.generateActivityBookThumbnails(harness.ids.bookId, {
    force: false,
    pageNumbers: [1, 2],
  });

  assert.equal(result.generated, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.items[1].pageNumber, 2);
  assert.equal(result.items[1].thumbnailStatus, 'failed');
  assert.equal(result.items[1].errorCode, 'PDF_PAGE_NOT_FOUND');
  assert.equal(result.items[1].stage, 'get-page');
  assert.equal(typeof result.items[1].durationMs, 'number');
  assert.equal(harness.state.pages[1].thumbnailStatus, 'failed');
  assert.equal(harness.state.pages[1].thumbnailErrorCode, 'PDF_PAGE_NOT_FOUND');
  assert.equal(harness.state.pages[1].thumbnailErrorStage, 'get-page');
  assert.ok(harness.state.pages[1].thumbnailLastAttemptAt instanceof Date);
});

test('generateActivityBookThumbnails in debug mode returns sanitized renderer error details', async () => {
  const harness = createHarness({
    renderErrors: {
      4: Object.assign(new Error('O renderizador nao conseguiu converter esta pagina em imagem.'), {
        code: 'PDF_RENDER_FAILED',
        stage: 'render',
        status: 502,
        originalName: 'UnknownErrorException',
        originalCode: 'ERR_RENDER',
        originalMessage: 'Setting up fake worker failed: Cannot find standard font data.',
      }),
    },
  });

  const result = await harness.service.generateActivityBookThumbnails(harness.ids.bookId, {
    force: true,
    debug: true,
    pageNumbers: [4],
  });

  assert.equal(result.processed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.items[0].thumbnailStatus, 'failed');
  assert.equal(result.items[0].errorCode, 'PDF_RENDER_FAILED');
  assert.equal(result.items[0].stage, 'render');
  assert.equal(result.items[0].debug.originalName, 'UnknownErrorException');
  assert.equal(result.items[0].debug.originalCode, 'ERR_RENDER');
  assert.match(result.items[0].debug.originalMessage, /standard font data/i);
  assert.match(result.items[0].debug.renderer, /pdfjs-dist@4\.10\.38/);
  assert.equal(harness.state.pages[3].thumbnailErrorCode, 'PDF_RENDER_FAILED');
  assert.equal(harness.state.pages[3].thumbnailErrorStage, 'render');
});

test('generateActivityBookThumbnails marks book as failed and never leaves processing on global failure', async () => {
  const harness = createHarness({
    downloadError: Object.assign(new Error('Objeto nao encontrado no R2.'), { code: 'R2_OBJECT_NOT_FOUND' }),
  });

  await assert.rejects(
    () => harness.service.generateActivityBookThumbnails(harness.ids.bookId, { force: true }),
    (error) => error.code === 'R2_DOWNLOAD_FAILED'
  );

  assert.equal(harness.state.book.thumbnailsStatus, 'failed');
  assert.match(harness.state.book.thumbnailsError, /Falha ao baixar o PDF original do R2/);
});

test('thumbnail generation emits safe operational logs without breaking execution', async () => {
  const harness = createHarness();

  await harness.service.generateActivityBookThumbnails(harness.ids.bookId, {
    force: false,
    pageNumbers: [1],
  });

  assert.equal(harness.logs.length > 0, true);
  assert.equal(harness.logs.some((line) => /\[activity-thumbnails\]/.test(line)), true);
});
