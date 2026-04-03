const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../config/database');
const NotificationLog = require('../api/models/notification-log.model');

async function runBackfillNotificationLogsMultichannel({
  batchSize = 200,
  maxToProcess = 0,
  dryRun = true,
} = {}) {
  let processed = 0;
  let updated = 0;
  let lastId = null;

  console.log('[Backfill] Starting notification log multichannel backfill', {
    batchSize,
    maxToProcess,
    dryRun,
  });

  while (true) {
    const query = {};

    if (lastId) {
      query._id = { $gt: lastId };
    }

    const docs = await NotificationLog.find(query)
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();

    if (docs.length === 0) {
      break;
    }

    const operations = [];

    for (const doc of docs) {
      processed += 1;
      lastId = doc._id;

      const patch = NotificationLog.buildCompatibilityPatch(doc);

      if (Object.keys(patch).length > 0) {
        updated += 1;

        if (!dryRun) {
          operations.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: patch },
            },
          });
        }
      }

      if (maxToProcess > 0 && processed >= maxToProcess) {
        break;
      }
    }

    if (!dryRun && operations.length > 0) {
      await NotificationLog.bulkWrite(operations, { ordered: false });
    }

    console.log('[Backfill] Batch processed', {
      processed,
      updated,
      lastId: String(lastId),
      dryRun,
    });

    if (maxToProcess > 0 && processed >= maxToProcess) {
      break;
    }
  }

  return {
    processed,
    updated,
    dryRun,
  };
}

async function runFromCli() {
  const batchSize = Number(process.env.NOTIFICATION_BACKFILL_BATCH_SIZE || 200);
  const maxToProcess = Number(process.env.NOTIFICATION_BACKFILL_MAX || 0);
  const dryRun = String(process.env.NOTIFICATION_BACKFILL_DRYRUN || 'true').toLowerCase() === 'true';

  try {
    await connectDB();

    const result = await runBackfillNotificationLogsMultichannel({
      batchSize,
      maxToProcess,
      dryRun,
    });

    console.log('[Backfill] Completed', result);
  } catch (error) {
    console.error('[Backfill] Failed', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  runFromCli();
}

module.exports = {
  runBackfillNotificationLogsMultichannel,
};
