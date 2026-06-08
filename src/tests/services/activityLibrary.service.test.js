const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const ActivityBook = require('../../api/models/activityBook.model');
const ActivityPage = require('../../api/models/activityPage.model');
const ActivityPrintRun = require('../../api/models/activityPrintRun.model');
const activityLibraryService = require('../../api/services/activityLibrary.service');
const r2StorageService = require('../../api/services/r2Storage.service');
const {
  buildActivityBookStoragePrefix,
  ensureSafeActivityBookStoragePrefix,
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

test('listSchoolLibraryForPlatform returns only printable activity pages with layout details', async () => {
  const schoolId = String(new mongoose.Types.ObjectId());
  const visibleBookId = new mongoose.Types.ObjectId();
  const hiddenBookId = new mongoose.Types.ObjectId();
  const visiblePageId = new mongoose.Types.ObjectId();

  const restore = patchMethods([
    {
      target: ActivityBook,
      key: 'find',
      value() {
        return createQuery([
          {
            _id: visibleBookId,
            title: 'Caderno Visivel',
            subject: 'Portugues',
            segment: 'Educacao Infantil',
            grade: 'Pre-escola',
            visibility: 'restricted',
            defaultPrintLayout: { mode: 'overlay' },
            defaultHeaderOverlay: { xPct: 2, yPct: 2, widthPct: 96, heightPct: 14 },
          },
          {
            _id: hiddenBookId,
            title: 'Caderno Oculto',
            subject: 'Matematica',
            segment: 'Fundamental I',
            grade: '1 ano',
            visibility: 'global',
          },
        ]);
      },
    },
    {
      target: ActivityPage,
      key: 'find',
      value() {
        return createQuery([
          {
            _id: visiblePageId,
            bookId: visibleBookId,
            title: 'Pagina 04',
            pageNumber: 4,
            subject: 'Portugues',
            segment: 'Educacao Infantil',
            grade: 'Pre-escola',
            enabled: true,
            printable: true,
            pageType: 'activity',
            status: 'published',
            printLayout: {
              mode: 'crop-and-recompose',
              academyHeaderHeightPct: 18,
              preserveFooter: true,
              scaleMode: 'fit-width',
            },
            contentCrop: { xPct: 4, yPct: 18, widthPct: 92, heightPct: 72 },
            footerCrop: { xPct: 4, yPct: 91, widthPct: 92, heightPct: 6 },
            headerOverlay: { xPct: 2, yPct: 2, widthPct: 96, heightPct: 14 },
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
    const result = await activityLibraryService.listSchoolLibraryForPlatform(schoolId, {});
    assert.equal(result.total, 1);
    assert.equal(result.items[0].activityPageId, String(visiblePageId));
    assert.equal(result.items[0].bookTitle, 'Caderno Visivel');
    assert.equal(result.items[0].pageType, 'activity');
    assert.deepEqual(result.items[0].contentCrop, { xPct: 4, yPct: 18, widthPct: 92, heightPct: 72 });
  } finally {
    restore();
  }
});

test('getSchoolBookDownloadUrl returns signed url for visible published book', async () => {
  const schoolId = String(new mongoose.Types.ObjectId());
  const bookId = new mongoose.Types.ObjectId();

  const restore = patchMethods([
    {
      target: ActivityBook,
      key: 'findById',
      value() {
        return createQuery({
          _id: bookId,
          title: 'Caderno de Alfabetizacao',
          status: 'published',
          visibility: 'restricted',
          allowedSchoolIds: [schoolId],
          originalPdfKey: `platform/activity-books/${bookId}/original.pdf`,
        });
      },
    },
    {
      target: r2StorageService,
      key: 'getSignedDownloadUrl',
      value: async (key, expiresIn) => ({
        url: `https://signed.example/${encodeURIComponent(key)}?exp=${expiresIn}`,
      }),
    },
  ]);

  try {
    const result = await activityLibraryService.getSchoolBookDownloadUrl(
      schoolId,
      String(bookId),
      300
    );

    assert.equal(result.bookId, String(bookId));
    assert.equal(
      result.url,
      `https://signed.example/${encodeURIComponent(`platform/activity-books/${bookId}/original.pdf`)}?exp=300`
    );
    assert.equal(result.expiresIn, 300);
  } finally {
    restore();
  }
});

test('getSchoolBookDownloadUrl rejects books not visible to the school', async () => {
  const schoolId = String(new mongoose.Types.ObjectId());
  const otherSchoolId = String(new mongoose.Types.ObjectId());
  const bookId = new mongoose.Types.ObjectId();

  const restore = patchMethods([
    {
      target: ActivityBook,
      key: 'findById',
      value() {
        return createQuery({
          _id: bookId,
          title: 'Caderno Restrito',
          status: 'published',
          visibility: 'restricted',
          allowedSchoolIds: [otherSchoolId],
          originalPdfKey: `platform/activity-books/${bookId}/original.pdf`,
        });
      },
    },
  ]);

  try {
    await assert.rejects(
      () => activityLibraryService.getSchoolBookDownloadUrl(
        schoolId,
        String(bookId),
        300
      ),
      (error) => {
        assert.equal(error.status, 403);
        assert.equal(error.code, 'BOOK_NOT_AVAILABLE_FOR_SCHOOL');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('ensureSafeActivityBookStoragePrefix rejects insecure prefixes', () => {
  const bookId = String(new mongoose.Types.ObjectId());

  assert.throws(
    () => ensureSafeActivityBookStoragePrefix(bookId, 'platform/activity-books/outro-book/'),
    /Prefixo de storage inseguro/
  );

  assert.equal(
    ensureSafeActivityBookStoragePrefix(bookId, buildActivityBookStoragePrefix(bookId)),
    buildActivityBookStoragePrefix(bookId)
  );
});

test('deleteActivityBookPermanently removes book/pages and deletes only safe R2 objects', async () => {
  const bookId = new mongoose.Types.ObjectId();
  const pageId = new mongoose.Types.ObjectId();
  const safePrefix = buildActivityBookStoragePrefix(bookId);
  let deletedKeys = null;
  let listedPrefix = null;

  const restore = patchMethods([
    {
      target: ActivityBook,
      key: 'findById',
      value(id) {
        return createQuery(String(id) === String(bookId) ? {
          _id: bookId,
          originalPdfKey: `${safePrefix}original.pdf`,
        } : null);
      },
    },
    {
      target: ActivityPage,
      key: 'find',
      value() {
        return createQuery([
          {
            _id: pageId,
            thumbnailKey: `${safePrefix}thumbnails/page-001.png`,
          },
        ]);
      },
    },
    {
      target: ActivityPage,
      key: 'deleteMany',
      value: async () => ({ deletedCount: 1 }),
    },
    {
      target: ActivityBook,
      key: 'deleteOne',
      value: async () => ({ deletedCount: 1 }),
    },
    {
      target: ActivityPrintRun,
      key: 'countDocuments',
      value: async () => 2,
    },
    {
      target: r2StorageService,
      key: 'listObjectsByPrefix',
      value: async (prefix) => {
        listedPrefix = prefix;
        return [
          `${safePrefix}original.pdf`,
          `${safePrefix}thumbnails/page-001.png`,
          'schools/outro/gerado.pdf',
        ];
      },
    },
    {
      target: r2StorageService,
      key: 'deleteObjects',
      value: async (keys) => {
        deletedKeys = keys;
        return {
          deleted: keys,
          errors: [],
          deletedCount: keys.length,
        };
      },
    },
  ]);

  try {
    const result = await activityLibraryService.deleteActivityBookPermanently(String(bookId), {
      deleteFiles: true,
      deleteGeneratedPrints: false,
      reason: 'Remocao de teste',
    });

    assert.equal(listedPrefix, safePrefix);
    assert.deepEqual(deletedKeys, [
      `${safePrefix}original.pdf`,
      `${safePrefix}thumbnails/page-001.png`,
    ]);
    assert.equal(result.success, true);
    assert.equal(result.deleted.activityBook, true);
    assert.equal(result.deleted.activityPages, 1);
    assert.equal(result.deleted.r2Objects, 2);
    assert.equal(result.skipped.generatedPrints, true);
    assert.equal(result.skipped.printRunsPreserved, 2);
    assert.equal(result.errors[0].code, 'UNSAFE_STORAGE_KEY_SKIPPED');
  } finally {
    restore();
  }
});

test('deleteActivityBookPermanently preserves generated prints even when explicitly requested', async () => {
  const bookId = new mongoose.Types.ObjectId();
  const safePrefix = buildActivityBookStoragePrefix(bookId);

  const restore = patchMethods([
    {
      target: ActivityBook,
      key: 'findById',
      value() {
        return createQuery({
          _id: bookId,
          originalPdfKey: `${safePrefix}original.pdf`,
        });
      },
    },
    {
      target: ActivityPage,
      key: 'find',
      value() {
        return createQuery([]);
      },
    },
    {
      target: ActivityPage,
      key: 'deleteMany',
      value: async () => ({ deletedCount: 0 }),
    },
    {
      target: ActivityBook,
      key: 'deleteOne',
      value: async () => ({ deletedCount: 1 }),
    },
    {
      target: ActivityPrintRun,
      key: 'countDocuments',
      value: async () => 1,
    },
    {
      target: r2StorageService,
      key: 'listObjectsByPrefix',
      value: async () => [],
    },
    {
      target: r2StorageService,
      key: 'deleteObjects',
      value: async () => ({ deleted: [], errors: [], deletedCount: 0 }),
    },
  ]);

  try {
    const result = await activityLibraryService.deleteActivityBookPermanently(String(bookId), {
      deleteFiles: true,
      deleteGeneratedPrints: true,
    });

    assert.equal(result.skipped.generatedPrints, true);
    assert.equal(result.errors[0].code, 'GENERATED_PRINTS_DELETE_NOT_SUPPORTED');
  } finally {
    restore();
  }
});
