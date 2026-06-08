const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  ActivityThumbnailService,
  buildThumbnailKey,
  normalizePageList,
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
  const pageAId = new mongoose.Types.ObjectId();
  const pageBId = new mongoose.Types.ObjectId();
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
        _id: pageAId,
        bookId,
        pageNumber: 1,
        thumbnailKey: '',
        thumbnailStatus: 'pending',
        thumbnailError: '',
      },
      {
        _id: pageBId,
        bookId,
        pageNumber: 2,
        thumbnailKey: '',
        thumbnailStatus: 'pending',
        thumbnailError: '',
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
    promise: Promise.resolve(fakePdfDocument),
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
        if (options?.new) {
          return createQuery({ ...state.book });
        }
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
  });

  service.renderPdfPageToPng = async (pdfPage) => {
    state.renderCalls.push(pdfPage.pageNumber);
    if (overrides.renderErrors?.[pdfPage.pageNumber]) {
      throw overrides.renderErrors[pdfPage.pageNumber];
    }
    return {
      buffer: Buffer.from(`png-${pdfPage.pageNumber}`),
      width: 320,
      height: 480,
      contentType: 'image/png',
    };
  };

  return { service, state, ids: { bookId: String(bookId), pageAId: String(pageAId), pageBId: String(pageBId) } };
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

test('generateActivityBookThumbnails skips ready pages when force=false', async () => {
  const harness = createHarness({
    pages: [
      {
        thumbnailKey: 'platform/activity-books/book/thumbnails/page-001.png',
        thumbnailStatus: 'ready',
      },
      {},
    ],
  });

  const result = await harness.service.generateActivityBookThumbnails(harness.ids.bookId, { force: false });

  assert.equal(result.generated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(harness.state.renderCalls, [2]);
  assert.equal(harness.state.book.thumbnailsReady, 2);
  assert.equal(harness.state.book.thumbnailsStatus, 'ready');
});

test('generateActivityBookThumbnails regenerates ready pages when force=true', async () => {
  const harness = createHarness({
    pages: [
      {
        thumbnailKey: 'platform/activity-books/book/thumbnails/page-001.png',
        thumbnailStatus: 'ready',
      },
      {},
    ],
  });

  const result = await harness.service.generateActivityBookThumbnails(harness.ids.bookId, { force: true });

  assert.equal(result.generated, 2);
  assert.equal(result.skipped, 0);
  assert.deepEqual(harness.state.renderCalls, [1, 2]);
  assert.equal(harness.state.uploads.length, 2);
});

test('generateActivityBookThumbnails marks only failed pages as failed and keeps counters updated', async () => {
  const harness = createHarness({
    renderErrors: {
      2: new Error('Pagina corrompida'),
    },
  });

  const result = await harness.service.generateActivityBookThumbnails(harness.ids.bookId, { force: true });

  assert.equal(result.generated, 1);
  assert.equal(result.failed, 1);
  assert.equal(harness.state.pages[0].thumbnailStatus, 'ready');
  assert.equal(harness.state.pages[1].thumbnailStatus, 'failed');
  assert.equal(harness.state.pages[1].thumbnailKey, '');
  assert.equal(harness.state.book.thumbnailsReady, 1);
  assert.equal(harness.state.book.thumbnailsFailed, 1);
  assert.equal(harness.state.book.thumbnailsStatus, 'partial');
});

test('generateActivityBookThumbnails marks book as failed when download fails', async () => {
  const harness = createHarness({
    downloadError: Object.assign(new Error('Objeto nao encontrado no R2.'), { code: 'R2_OBJECT_NOT_FOUND' }),
  });

  await assert.rejects(
    () => harness.service.generateActivityBookThumbnails(harness.ids.bookId, { force: true }),
    (error) => error.code === 'R2_OBJECT_NOT_FOUND'
  );

  assert.equal(harness.state.book.thumbnailsStatus, 'failed');
  assert.match(harness.state.book.thumbnailsError, /Objeto nao encontrado no R2/);
});
