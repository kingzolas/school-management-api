const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const reportCardExamImportService = require('../../api/services/reportCardExamImport.service');
const examService = require('../../api/services/exam.service');
const Periodo = require('../../api/models/periodo.model');

function mockFindOne(result) {
  return {
    sort() {
      return this;
    },
    lean: async () => result,
  };
}

test('exam term resolution stores explicit term when payload and application date match', async () => {
  const originalFindOne = Periodo.findOne;
  const termId = new mongoose.Types.ObjectId();
  const schoolId = new mongoose.Types.ObjectId();
  const period = {
    _id: termId,
    school_id: schoolId,
    titulo: '2o Bimestre',
    dataInicio: new Date('2026-04-01T00:00:00.000Z'),
    dataFim: new Date('2026-06-30T23:59:59.000Z'),
  };

  Periodo.findOne = () => mockFindOne(period);

  try {
    const result = await examService.resolveExamTermContext({
      schoolId,
      termId,
      applicationDate: new Date('2026-05-10T12:00:00.000Z'),
    });

    assert.equal(result.termId, String(termId));
    assert.equal(result.termName, '2o Bimestre');
    assert.equal(result.termResolution.status, 'explicit');
    assert.equal(result.termResolution.source, 'payload');
  } finally {
    Periodo.findOne = originalFindOne;
  }
});

test('legacy exam without resolvable application date is marked as missing', async () => {
  const originalFindOne = Periodo.findOne;
  Periodo.findOne = () => mockFindOne(null);

  try {
    const result = await examService.resolveExamTermContext({
      schoolId: new mongoose.Types.ObjectId(),
      applicationDate: new Date('2026-01-10T12:00:00.000Z'),
      legacy: true,
    });

    assert.equal(result.termId, null);
    assert.equal(result.termName, null);
    assert.equal(result.termResolution.status, 'missing');
    assert.equal(result.termResolution.source, 'legacy_inference');
  } finally {
    Periodo.findOne = originalFindOne;
  }
});

test('exam without payload term infers term by application date', async () => {
  const originalFindOne = Periodo.findOne;
  const termId = new mongoose.Types.ObjectId();
  const schoolId = new mongoose.Types.ObjectId();
  const period = {
    _id: termId,
    school_id: schoolId,
    titulo: '1o Bimestre',
    dataInicio: new Date('2026-01-20T00:00:00.000Z'),
    dataFim: new Date('2026-03-31T23:59:59.000Z'),
  };

  Periodo.findOne = () => mockFindOne(period);

  try {
    const result = await examService.resolveExamTermContext({
      schoolId,
      applicationDate: new Date('2026-02-12T12:00:00.000Z'),
    });

    assert.equal(result.termId, String(termId));
    assert.equal(result.termName, '1o Bimestre');
    assert.equal(result.termResolution.status, 'inferred');
    assert.equal(result.termResolution.source, 'applicationDate');
  } finally {
    Periodo.findOne = originalFindOne;
  }
});

test('raw score preview accepts scale when final score stays within 10', () => {
  const scale = reportCardExamImportService._buildScaleStatus({
    originalMaxGrade: 10,
    proposedTestScore: 4,
    activityScore: 3,
    participationScore: 2,
    scoreMode: 'raw',
  });

  assert.equal(scale.scaleStatus, 'score_scale_ok');
  assert.equal(scale.predictedFinalScore, 9);
  assert.equal(scale.canApplyScale, true);
});

test('raw score preview blocks when final score exceeds 10', () => {
  const scale = reportCardExamImportService._buildScaleStatus({
    originalMaxGrade: 10,
    proposedTestScore: 7,
    activityScore: 3,
    participationScore: 1,
    scoreMode: 'raw',
  });

  assert.equal(scale.scaleStatus, 'final_score_exceeds_10');
  assert.equal(scale.predictedFinalScore, 11);
  assert.equal(scale.canApplyScale, false);
});

test('raw score preview requires explicit mode for exams above 10 points', () => {
  const proposal = reportCardExamImportService._calculateProposedScore({
    sheetScore: 16,
    sheetMaxScore: 20,
    examMaxScore: 20,
    scoreMode: 'raw',
  });
  const scale = reportCardExamImportService._buildScaleStatus({
    originalMaxGrade: proposal.originalMaxGrade,
    proposedTestScore: proposal.proposedTestScore,
    activityScore: 0,
    participationScore: 0,
    scoreMode: 'raw',
  });

  assert.equal(proposal.proposedTestScore, 16);
  assert.equal(scale.scaleStatus, 'score_scale_conflict');
  assert.equal(scale.canApplyScale, false);
});

test('explicit normalization converts exam score to the 0-10 component scale', () => {
  const proposal = reportCardExamImportService._calculateProposedScore({
    sheetScore: 16,
    sheetMaxScore: 20,
    examMaxScore: 20,
    scoreMode: 'normalize_to_component',
  });

  assert.equal(proposal.originalGrade, 16);
  assert.equal(proposal.originalMaxGrade, 20);
  assert.equal(proposal.proposedTestScore, 8);
});

test('idempotency key is stable for repeated commit payloads regardless of selected order', () => {
  const base = {
    schoolId: 'school-a',
    examId: 'exam-a',
    classId: 'class-a',
    subjectId: 'subject-a',
    termId: 'term-a',
    scoreMode: 'raw',
    selectedStudentIds: ['student-2', 'student-1'],
    conflictDecisions: {
      'student-3': { action: 'ignore' },
    },
  };

  const reordered = {
    ...base,
    selectedStudentIds: ['student-1', 'student-2'],
  };

  assert.equal(
    reportCardExamImportService._buildIdempotencyKey(base),
    reportCardExamImportService._buildIdempotencyKey(reordered)
  );
});
