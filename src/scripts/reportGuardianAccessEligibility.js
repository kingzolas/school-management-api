require('dotenv').config();

const connectDB = require('../config/database');
const guardianAuthService = require('../api/services/guardianAuth.service');

function parseArgs(argv = []) {
  return argv.reduce((accumulator, entry) => {
    if (!entry.startsWith('--')) return accumulator;

    const [rawKey, rawValue = ''] = entry.slice(2).split('=');
    accumulator[rawKey] = rawValue || true;
    return accumulator;
  }, {});
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  await connectDB();

  const report = await guardianAuthService.generateEligibilityReport({
    schoolId: args.schoolId || null,
    schoolPublicId: args.schoolPublicId || null,
  });

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

run().catch((error) => {
  console.error('[guardian-access-eligibility] failed:', error.message);
  process.exit(1);
});
