const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const ActivityBook = require('../../api/models/activityBook.model');
const ActivityPage = require('../../api/models/activityPage.model');
const activityLibraryService = require('../../api/services/activityLibrary.service');
const r2StorageService = require('../../api/services/r2Storage.service');
const {
  validatePctRect,
  validatePrintLayout,
} = require('../../api/services/activityLibrary.service');

function createQuery(value) {
  return {
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function patchMethods(entries) {
  const restores = entries.map(({ target, key, value }) => {
    const original = target[key];
    target[key] = value;
    return () => {
      target[key] = original;
    };
  });

  return () => restores.reverse().forEach((restore) => restore());
}

test('validatePctRect rejects out-of-bounds and zero-sized rectangles', () => {
  assert.throws(
    () => validatePctRect({ xPct: 0, yPct: 0, widthPct: 0, heightPct: 10 }, 'INVALID_RECT'),
    /maiores que zero/
  );

  assert.throws(
    () => validatePctRect({ xPct: 10, yPct: 10, widthPct: 95, heightPct: 10 }, 'INVALID_RECT'),
    /nao pode ultrapassar 100/
  );

  assert.deepEqual(
    validatePctRect({ xPct: 2, yPct: 2, widthPct: 96, heightPct: 18 }),
    { xPct: 2, yPct: 2, widthPct: 96, heightPct: 18 }
  );
});

test('validatePrintLayout rejects empty payload and invalid modes', () => {
  assert.throws(() => validatePrintLayout({}, 'INVALID_LAYOUT'), /Payload vazio/);
  assert.throws(
    () => validatePrintLayout({ mode: 'bad-mode' }, 'INVALID_LAYOUT'),
    /mode invalido/
  );

  assert.deepEqual(
    validatePrintLayout({ mode: 'overlay', academyHeaderHeightPct: 18, preserveFooter: true, scaleMode: 'fit-width' }),
    {
      mode: 'overlay',
      academyHeaderHeightPct: 18,
      preserveFooter: true,
      scaleMode: 'fit-width',
    }
  );
});

test('listSchoolLibrary keeps compatibility with legacy pages missing pageType', async () => {
  const schoolId = String(new mongoose.Types.ObjectId());
  const bookId = new mongoose.Types.ObjectId();

  const restore = patchMethods([
    {
      target: ActivityBook,
      key: 'find',
      value() {
        return createQuery([
          {
            _id: bookId,
            title: 'Caderno Teste',
            subject: 'Portugues',
            segment: 'Fundamental I',
            grade: '3 ano',
            visibility: 'global',
          },
        ]);
      },
    },
    {
      target: ActivityBook,
      key: 'countDocuments',
      value: async () => 1,
    },
    {
      target: ActivityPage,
      key: 'find',
      value() {
        return createQuery([
          {
            _id: new mongoose.Types.ObjectId(),
            bookId,
            title: 'Atividade sem pageType salvo',
            description: '',
            subject: 'Portugues',
            segment: 'Fundamental I',
            grade: '3 ano',
            pageNumber: 3,
            thumbnailUrl: '',
            tags: ['vogais'],
            enabled: true,
            status: 'published',
          },
        ]);
      },
    },
    {
      target: ActivityPage,
      key: 'countDocuments',
      value: async () => 1,
    },
  ]);

  try {
    const result = await activityLibraryService.listSchoolLibrary(schoolId, {});
    assert.equal(result.total, 1);
    assert.equal(result.items[0].title, 'Atividade sem pageType salvo');
  } finally {
    restore();
  }
});

test('listPages returns thumbnailUrl null when thumbnail is not ready', async () => {
  const bookId = new mongoose.Types.ObjectId();
  const pageId = new mongoose.Types.ObjectId();
  let signedCalls = 0;

  const restore = patchMethods([
    {
      target: ActivityBook,
      key: 'findById',
      value() {
        return createQuery({
          _id: bookId,
          title: 'Caderno Teste',
          status: 'published',
        });
      },
    },
    {
      target: ActivityPage,
      key: 'find',
      value() {
        return createQuery([
          {
            _id: pageId,
            bookId,
            pageNumber: 1,
            thumbnailKey: 'platform/activity-books/book/thumbnails/page-001.png',
            thumbnailStatus: 'failed',
            thumbnailError: 'Falha ao gerar',
          },
        ]);
      },
    },
    {
      target: r2StorageService,
      key: 'getSignedDownloadUrl',
      value: async () => {
        signedCalls += 1;
        return { url: 'https://signed.example/thumb.png' };
      },
    },
  ]);

  try {
    const pages = await activityLibraryService.listPages(String(bookId));
    assert.equal(pages.length, 1);
    assert.equal(pages[0].thumbnailUrl, null);
    assert.equal(pages[0].thumbnailError, 'Falha ao gerar');
    assert.equal(signedCalls, 0);
  } finally {
    restore();
  }
});

test('listPages signs thumbnailUrl when thumbnail is ready', async () => {
  const bookId = new mongoose.Types.ObjectId();
  const pageId = new mongoose.Types.ObjectId();

  const restore = patchMethods([
    {
      target: ActivityBook,
      key: 'findById',
      value() {
        return createQuery({
          _id: bookId,
          title: 'Caderno Teste',
          status: 'published',
        });
      },
    },
    {
      target: ActivityPage,
      key: 'find',
      value() {
        return createQuery([
          {
            _id: pageId,
            bookId,
            pageNumber: 1,
            thumbnailKey: 'platform/activity-books/book/thumbnails/page-001.png',
            thumbnailStatus: 'ready',
            thumbnailError: '',
          },
        ]);
      },
    },
    {
      target: r2StorageService,
      key: 'getSignedDownloadUrl',
      value: async () => ({ url: 'https://signed.example/thumb.png' }),
    },
  ]);

  try {
    const pages = await activityLibraryService.listPages(String(bookId));
    assert.equal(pages.length, 1);
    assert.equal(pages[0].thumbnailUrl, 'https://signed.example/thumb.png');
    assert.equal(pages[0].thumbnailError, null);
  } finally {
    restore();
  }
});
