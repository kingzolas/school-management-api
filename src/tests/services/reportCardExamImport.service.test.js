const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const reportCardExamImportService = require('../../api/services/reportCardExamImport.service');
const examService = require('../../api/services/exam.service');
const Periodo = require('../../api/models/periodo.model');
const Class = require('../../api/models/class.model');
const Exam = require('../../api/models/exam.model');
const ExamSheet = require('../../api/models/exam-sheet.model');
const Enrollment = require('../../api/models/enrollment.model');
const ReportCard = require('../../api/models/reportCard.model');

function mockFindOne(result) {
  return {
    sort() {
      return this;
    },
    lean: async () => result,
  };
}

function mockFindMany(result) {
  return {
    sort() {
      return this;
    },
    populate() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => result,
  };
}

function mockFindOneSelectable(result) {
  return {
    select: async () => result,
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

test('importable exam list computes card summary without calling preview or ensuring report cards', async () => {
  const schoolId = new mongoose.Types.ObjectId();
  const classId = new mongoose.Types.ObjectId();
  const subjectId = new mongoose.Types.ObjectId();
  const teacherId = new mongoose.Types.ObjectId();
  const termId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const sheetId = new mongoose.Types.ObjectId();
  const reportCardId = new mongoose.Types.ObjectId();

  const originals = {
    classFindOne: Class.findOne,
    examFind: Exam.find,
    examSheetFind: ExamSheet.find,
    enrollmentFind: Enrollment.find,
    reportCardFind: ReportCard.find,
    periodoFind: Periodo.find,
    resolveStoredExamTermContext: examService._resolveStoredExamTermContext,
    previewExamImport: reportCardExamImportService.previewExamImport,
  };

  Class.findOne = () => mockFindOneSelectable({ _id: classId, school_id: schoolId, name: '1oB' });
  Periodo.find = () => mockFindMany([
    {
      _id: termId,
      titulo: '2o Bimestre',
      dataInicio: new Date('2026-04-01T00:00:00.000Z'),
      dataFim: new Date('2026-06-30T23:59:59.000Z'),
      anoLetivoId: { _id: new mongoose.Types.ObjectId(), year: 2026 },
    },
  ]);
  Exam.find = () => mockFindMany([
    {
      _id: examId,
      title: 'Prova de Linguagem 15q',
      class_id: { _id: classId, name: '1oB' },
      subject_id: { _id: subjectId, name: 'Linguagem' },
      teacher_id: { _id: teacherId, fullName: 'Professor' },
      termId: { _id: termId, titulo: '2o Bimestre' },
      applicationDate: new Date('2026-06-16T12:00:00.000Z'),
      status: 'PUBLISHED',
      correctionType: 'BUBBLE_SHEET',
      totalValue: 15,
    },
  ]);
  ExamSheet.find = () => mockFindMany([
    {
      _id: sheetId,
      exam_id: examId,
      student_id: studentId,
      grade: 15,
      maxGrade: 15,
      status: 'SCANNED',
    },
  ]);
  Enrollment.find = () => mockFindMany([
    {
      _id: new mongoose.Types.ObjectId(),
      student: studentId,
    },
  ]);
  ReportCard.find = () => mockFindMany([
    {
      _id: reportCardId,
      termId,
      studentId,
      releasedForPrint: false,
      status: 'Rascunho',
      subjects: [
        {
          subjectId,
          teacherId,
          testScore: null,
          activityScore: 0,
          participationScore: 0,
        },
      ],
    },
  ]);
  examService._resolveStoredExamTermContext = async () => ({
    termId: String(termId),
    termName: '2o Bimestre',
    termResolution: { status: 'explicit', source: 'payload' },
  });
  reportCardExamImportService.previewExamImport = async () => {
    throw new Error('previewExamImport should not be called by listImportableExams');
  };

  try {
    const result = await reportCardExamImportService.listImportableExams({
      schoolId,
      actor: { role: 'ADMIN' },
      classId: String(classId),
      termId: String(termId),
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].totalSheets, 1);
    assert.equal(result[0].correctedSheets, 1);
    assert.equal(result[0].importableCount, 1);
    assert.equal(result[0].alreadyImportedCount, 0);
    assert.equal(result[0].conflictCount, 0);
    assert.equal(result[0].blockedCount, 0);
    assert.equal(result[0].scoreMode, 'normalize_to_component');
  } finally {
    Class.findOne = originals.classFindOne;
    Exam.find = originals.examFind;
    ExamSheet.find = originals.examSheetFind;
    Enrollment.find = originals.enrollmentFind;
    ReportCard.find = originals.reportCardFind;
    Periodo.find = originals.periodoFind;
    examService._resolveStoredExamTermContext = originals.resolveStoredExamTermContext;
    reportCardExamImportService.previewExamImport = originals.previewExamImport;
  }
});
