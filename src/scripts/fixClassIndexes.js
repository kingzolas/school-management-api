const mongoose = require('mongoose');
require('dotenv').config();

const ACTIVE_CLASS_STATUSES = ['Planejada', 'Ativa'];
const CLASSES_COLLECTION = 'classes';
const CORRECT_INDEX_NAME = 'unique_active_class_by_school_year_shift_name';
const CORRECT_INDEX_KEY = {
  school_id: 1,
  schoolYear: 1,
  shift: 1,
  name: 1,
};
const CORRECT_PARTIAL_FILTER = {
  status: { $in: ACTIVE_CLASS_STATUSES },
};
const CORRECT_COLLATION = { locale: 'pt', strength: 2 };

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function sameObject(left = {}, right = {}) {
  return stableStringify(left) === stableStringify(right);
}

function indexHasCorrectKey(index) {
  return sameObject(index?.key || {}, CORRECT_INDEX_KEY);
}

function indexHasCorrectPartialFilter(index) {
  return sameObject(index?.partialFilterExpression || {}, CORRECT_PARTIAL_FILTER);
}

function indexHasCorrectCollation(index) {
  const collation = index?.collation || {};
  return collation.locale === CORRECT_COLLATION.locale && collation.strength === CORRECT_COLLATION.strength;
}

function isCorrectClassUniqueIndex(index) {
  return (
    index?.unique === true &&
    indexHasCorrectKey(index) &&
    indexHasCorrectPartialFilter(index) &&
    indexHasCorrectCollation(index)
  );
}

function isClassUniquenessCandidate(index) {
  const key = index?.key || {};
  return index?.unique === true && key.name === 1 && key.schoolYear === 1;
}

function isLegacyOrIncorrectClassUniqueIndex(index) {
  return isClassUniquenessCandidate(index) && !isCorrectClassUniqueIndex(index);
}

function serializeIndex(index) {
  return {
    name: index.name,
    key: index.key,
    unique: Boolean(index.unique),
    partialFilterExpression: index.partialFilterExpression || null,
    collation: index.collation || null,
  };
}

function formatClassDoc(doc = {}) {
  return {
    _id: String(doc._id),
    school_id: doc.school_id ? String(doc.school_id) : null,
    schoolYear: doc.schoolYear,
    shift: doc.shift,
    name: doc.name,
    status: doc.status,
  };
}

async function findActiveClassConflicts(collection) {
  return collection
    .aggregate(
      [
        {
          $match: {
            status: { $in: ACTIVE_CLASS_STATUSES },
          },
        },
        {
          $group: {
            _id: {
              school_id: '$school_id',
              schoolYear: '$schoolYear',
              shift: '$shift',
              name: '$name',
            },
            count: { $sum: 1 },
            docs: {
              $push: {
                _id: '$_id',
                school_id: '$school_id',
                schoolYear: '$schoolYear',
                shift: '$shift',
                name: '$name',
                status: '$status',
              },
            },
          },
        },
        {
          $match: {
            count: { $gt: 1 },
          },
        },
        {
          $sort: {
            '_id.school_id': 1,
            '_id.schoolYear': 1,
            '_id.shift': 1,
            '_id.name': 1,
          },
        },
      ],
      { collation: CORRECT_COLLATION }
    )
    .toArray();
}

async function ensureCorrectIndex(collection, { dryRun }) {
  const indexes = await collection.indexes();
  const correctIndex = indexes.find(isCorrectClassUniqueIndex);

  if (correctIndex) {
    console.log('[ClassIndexes] Correct index already exists', serializeIndex(correctIndex));
    return { created: false, existingIndex: correctIndex.name };
  }

  const sameKeyWrongIndex = indexes.find((index) => indexHasCorrectKey(index) && !isCorrectClassUniqueIndex(index));
  if (sameKeyWrongIndex) {
    throw new Error(
      `[ClassIndexes] Found an index with the correct key but wrong options: ${sameKeyWrongIndex.name}. ` +
        'Review/drop it before creating the correct partial unique index.'
    );
  }

  console.log('[ClassIndexes] Correct index is missing', {
    name: CORRECT_INDEX_NAME,
    key: CORRECT_INDEX_KEY,
    unique: true,
    partialFilterExpression: CORRECT_PARTIAL_FILTER,
    collation: CORRECT_COLLATION,
    dryRun,
  });

  if (dryRun) {
    return { created: false, dryRun: true };
  }

  await collection.createIndex(CORRECT_INDEX_KEY, {
    name: CORRECT_INDEX_NAME,
    unique: true,
    partialFilterExpression: CORRECT_PARTIAL_FILTER,
    collation: CORRECT_COLLATION,
  });

  console.log('[ClassIndexes] Correct index created', { name: CORRECT_INDEX_NAME });
  return { created: true };
}

async function runFixClassIndexes({ dryRun = true } = {}) {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required to run this script.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const collection = mongoose.connection.collection(CLASSES_COLLECTION);

  try {
    const indexes = await collection.indexes();
    const legacyIndexes = indexes.filter(isLegacyOrIncorrectClassUniqueIndex);

    console.log('[ClassIndexes] Current indexes', indexes.map(serializeIndex));

    const conflicts = await findActiveClassConflicts(collection);
    if (conflicts.length > 0) {
      console.error(
        '[ClassIndexes] Aborting because real duplicate classes exist under the correct uniqueness rule',
        conflicts.map((conflict) => ({
          key: {
            school_id: conflict._id.school_id ? String(conflict._id.school_id) : null,
            schoolYear: conflict._id.schoolYear,
            shift: conflict._id.shift,
            name: conflict._id.name,
          },
          count: conflict.count,
          docs: conflict.docs.map(formatClassDoc),
        }))
      );
      throw new Error('Resolve the duplicate class records before changing indexes.');
    }

    console.log('[ClassIndexes] No active duplicate classes found for the correct uniqueness rule.');

    if (legacyIndexes.length === 0) {
      console.log('[ClassIndexes] No legacy/incorrect unique class indexes found.');
    }

    for (const index of legacyIndexes) {
      console.log('[ClassIndexes] Legacy/incorrect unique index detected', serializeIndex(index));

      if (dryRun) {
        console.log('[ClassIndexes] Dry run: index would be dropped', { name: index.name });
        continue;
      }

      await collection.dropIndex(index.name);
      console.log('[ClassIndexes] Dropped legacy/incorrect unique index', { name: index.name });
    }

    const correctIndexResult = await ensureCorrectIndex(collection, { dryRun });
    const finalIndexes = await collection.indexes();

    console.log('[ClassIndexes] Finished', {
      dryRun,
      droppedIndexes: dryRun ? [] : legacyIndexes.map((index) => index.name),
      legacyIndexesDetected: legacyIndexes.map((index) => index.name),
      correctIndexResult,
      finalIndexes: finalIndexes.map(serializeIndex),
    });

    return {
      dryRun,
      conflicts,
      legacyIndexes: legacyIndexes.map(serializeIndex),
      correctIndexResult,
    };
  } finally {
    await mongoose.connection.close();
  }
}

async function runFromCli() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply') || String(process.env.CLASS_INDEX_FIX_APPLY || '').toLowerCase() === 'true';
  const dryRun = !apply;

  try {
    await runFixClassIndexes({ dryRun });
  } catch (error) {
    console.error('[ClassIndexes] Failed', error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runFromCli();
}

module.exports = {
  ACTIVE_CLASS_STATUSES,
  CORRECT_INDEX_NAME,
  CORRECT_INDEX_KEY,
  CORRECT_PARTIAL_FILTER,
  findActiveClassConflicts,
  isCorrectClassUniqueIndex,
  isLegacyOrIncorrectClassUniqueIndex,
  runFixClassIndexes,
};
