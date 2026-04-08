require('dotenv').config();

const connectDB = require('../config/database');
const School = require('../api/models/school.model');
const Student = require('../api/models/student.model');
const Tutor = require('../api/models/tutor.model');
const {
  buildBirthDateKey,
  buildPublicIdentifier,
  normalizeCpf,
  normalizeName,
} = require('../api/utils/guardianAccess.util');

function parseArgs(argv = []) {
  return argv.reduce((accumulator, entry) => {
    if (!entry.startsWith('--')) return accumulator;

    const [rawKey, rawValue = ''] = entry.slice(2).split('=');
    accumulator[rawKey] = rawValue || true;
    return accumulator;
  }, {});
}

async function resolveSchoolFilter(args = {}) {
  if (args.schoolId) {
    return { _id: args.schoolId };
  }

  if (args.schoolPublicId) {
    return { publicIdentifier: buildPublicIdentifier(args.schoolPublicId) };
  }

  return {};
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  await connectDB();

  const schoolFilter = await resolveSchoolFilter(args);
  const schools = await School.find(schoolFilter).select('_id').lean();
  const schoolIds = schools.map((school) => school._id);

  if (!schoolIds.length) {
    console.log(
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          schoolsProcessed: 0,
          schoolsUpdated: 0,
          studentsUpdated: 0,
          tutorsUpdated: 0,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const schoolRecords = await School.find({ _id: { $in: schoolIds } })
    .select('_id name publicIdentifier')
    .lean();
  const students = await Student.find({ school_id: { $in: schoolIds } })
    .select('_id fullName birthDate fullNameNormalized birthDateKey school_id')
    .lean();
  const tutors = await Tutor.find({ school_id: { $in: schoolIds } })
    .select('_id cpf cpfNormalized school_id')
    .lean();

  const schoolOperations = schoolRecords
    .map((school) => {
      const publicIdentifier = school.publicIdentifier || buildPublicIdentifier(school.name);

      if (school.publicIdentifier === publicIdentifier || !publicIdentifier) {
        return null;
      }

      return {
        updateOne: {
          filter: { _id: school._id },
          update: {
            $set: {
              publicIdentifier,
            },
          },
        },
      };
    })
    .filter(Boolean);

  const studentOperations = students
    .map((student) => {
      const fullNameNormalized = normalizeName(student.fullName);
      const birthDateKey = buildBirthDateKey(student.birthDate);

      if (
        student.fullNameNormalized === fullNameNormalized &&
        student.birthDateKey === birthDateKey
      ) {
        return null;
      }

      return {
        updateOne: {
          filter: { _id: student._id },
          update: {
            $set: {
              fullNameNormalized,
              birthDateKey,
            },
          },
        },
      };
    })
    .filter(Boolean);

  const tutorOperations = tutors
    .map((tutor) => {
      const cpfNormalized = normalizeCpf(tutor.cpf);

      if (tutor.cpfNormalized === cpfNormalized) {
        return null;
      }

      return {
        updateOne: {
          filter: { _id: tutor._id },
          update: {
            $set: {
              cpfNormalized,
            },
          },
        },
      };
    })
    .filter(Boolean);

  const [schoolResult, studentResult, tutorResult] = await Promise.all([
    schoolOperations.length
      ? School.bulkWrite(schoolOperations, { ordered: false })
      : { modifiedCount: 0 },
    studentOperations.length
      ? Student.bulkWrite(studentOperations, { ordered: false })
      : { modifiedCount: 0 },
    tutorOperations.length
      ? Tutor.bulkWrite(tutorOperations, { ordered: false })
      : { modifiedCount: 0 },
  ]);

  console.log(
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        schoolsProcessed: schoolIds.length,
        schoolsUpdated: schoolResult.modifiedCount || 0,
        studentsUpdated: studentResult.modifiedCount || 0,
        tutorsUpdated: tutorResult.modifiedCount || 0,
      },
      null,
      2
    )
  );

  process.exit(0);
}

run().catch((error) => {
  console.error('[guardian-access-backfill] failed:', error.message);
  process.exit(1);
});
