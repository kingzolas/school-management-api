const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const examService = require('../../api/services/exam.service');
const omrProcessingService = require('../../api/services/omrProcessing.service');

function pythonBin() {
  return process.env.OMR_PYTHON_BIN || process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
}

function runPython(code) {
  const result = spawnSync(pythonBin(), ['-c', code], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONPATH: path.join(process.cwd(), 'src', 'scripts'),
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function parseLastJson(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .reverse()
    .find((item) => item.startsWith('{') && item.endsWith('}'));

  assert.ok(line, `Nenhum JSON encontrado em stdout: ${stdout}`);
  return JSON.parse(line);
}

function buildExamFixture(totalQuestions, totalValue = 10) {
  return {
    correctionType: 'BUBBLE_SHEET',
    totalValue,
    questions: Array.from({ length: totalQuestions }, (_, index) => ({
      _id: `question-${index + 1}`,
      type: 'OBJECTIVE',
      text: `Question ${index + 1}`,
      correctAnswer: 'A',
      weight: 1,
    })),
  };
}

function buildOmrAnswers(totalQuestions, correctCount) {
  return Array.from({ length: totalQuestions }, (_, index) => ({
    question: index + 1,
    marked: index < correctCount ? 'A' : 'B',
    status: 'ok',
    debugStatus: 'marked',
    confidence: 0.95,
  }));
}

test('OMR v2 correction normalizes score to exam scale instead of returning correct count', () => {
  const cases = [
    { questions: 5, correct: 5, expectedGrade: 10 },
    { questions: 5, correct: 4, expectedGrade: 8 },
    { questions: 10, correct: 10, expectedGrade: 10 },
    { questions: 10, correct: 7, expectedGrade: 7 },
    { questions: 15, correct: 15, expectedGrade: 10 },
    { questions: 15, correct: 12, expectedGrade: 8 },
    { questions: 15, correct: 9, expectedGrade: 6 },
    { questions: 40, correct: 40, expectedGrade: 10 },
    { questions: 40, correct: 20, expectedGrade: 5 },
  ];

  for (const item of cases) {
    const correction = examService.buildBubbleSheetCorrection(
      buildExamFixture(item.questions),
      buildOmrAnswers(item.questions, item.correct)
    );

    assert.equal(correction.correctCount, item.correct);
    assert.equal(correction.totalQuestions, item.questions);
    assert.equal(correction.grade, item.expectedGrade);
    assert.equal(correction.objectiveGrade, item.expectedGrade);
    assert.ok(correction.grade <= 10, `grade above 10 for ${item.questions}/${item.correct}`);
  }
});

test('OMR v2 correction exposes question-level pedagogical details and counters', () => {
  const exam = buildExamFixture(4);
  const correction = examService.buildBubbleSheetCorrection(exam, [
    { question: 1, marked: 'A', status: 'ok', debugStatus: 'marked', confidence: 0.94 },
    { question: 2, marked: 'B', status: 'ok', debugStatus: 'marked', confidence: 0.91 },
    { question: 3, marked: null, status: 'blank', debugStatus: 'blank', confidence: 0.88 },
    {
      question: 4,
      marked: null,
      status: 'multiple',
      debugStatus: 'multiple',
      markedAlternatives: ['A', 'C'],
      confidence: 0.76,
    },
  ]);

  assert.equal(correction.grade, 2.5);
  assert.equal(correction.objectiveGrade, 2.5);
  assert.equal(correction.correctCount, 1);
  assert.equal(correction.wrongCount, 1);
  assert.equal(correction.blankCount, 1);
  assert.equal(correction.multipleCount, 1);
  assert.equal(correction.uncertainCount, 0);
  assert.equal(correction.notDetectedCount, 0);
  assert.deepEqual(correction.studentAnswers, {
    1: 'A',
    2: 'B',
    3: null,
    4: 'MULTIPLE',
  });
  assert.deepEqual(correction.answerKey, {
    1: 'A',
    2: 'A',
    3: 'A',
    4: 'A',
  });
  assert.equal(correction.questionResults.length, 4);
  assert.deepEqual(
    correction.questionResults.map((question) => question.status),
    ['correct', 'wrong', 'blank', 'multiple']
  );
  assert.equal(correction.correctionDetailsPayload.questionResults.length, 4);
  assert.equal(
    correction.questionResults.filter((question) => question.status === 'correct').length,
    correction.correctCount
  );
  assert.equal(
    correction.questionResults.filter((question) => question.status === 'wrong').length,
    correction.wrongCount
  );
  assert.equal(
    correction.questionResults.filter((question) => question.status === 'blank').length,
    correction.blankCount
  );
  assert.equal(
    correction.questionResults.filter((question) => question.status === 'multiple').length,
    correction.multipleCount
  );
});

test('OMR confirmation payload can persist answers from correctionDetails questionResults', () => {
  const normalized = examService._normalizePersistableSheetAnswers({
    correctionDetails: {
      questionResults: [
        {
          questionNumber: 1,
          correctAnswer: 'B',
          studentAnswer: 'B',
          isCorrect: true,
          status: 'correct',
          omrStatus: 'marked',
          confidence: 0.94,
          points: 2.5,
          maxPoints: 2.5,
        },
        {
          questionNumber: 2,
          correctAnswer: 'C',
          studentAnswer: 'MULTIPLE',
          isCorrect: false,
          status: 'multiple',
          omrStatus: 'multiple',
          markedAlternatives: ['A', 'C'],
          confidence: 0.76,
          points: 0,
          maxPoints: 2.5,
        },
      ],
    },
  });

  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], {
    question_id: undefined,
    questionNumber: 1,
    markedOption: 'B',
    correctAnswer: 'B',
    status: 'ok',
    omrStatus: 'marked',
    markedAlternatives: [],
    confidence: 0.94,
    isCorrect: true,
    earnedPoints: 2.5,
    maxPoints: 2.5,
  });
  assert.equal(normalized[1].markedOption, 'MULTIPLE');
  assert.equal(normalized[1].status, 'multiple');
  assert.deepEqual(normalized[1].markedAlternatives, ['A', 'C']);
});

test('OMR correction keeps legacy details list and structured summary separate', () => {
  const correction = examService.buildBubbleSheetCorrection(
    buildExamFixture(15),
    buildOmrAnswers(15, 15)
  );

  assert.equal(correction.grade, 10);
  assert.equal(correction.objectiveGrade, 10);
  assert.equal(correction.correctCount, 15);
  assert.equal(correction.totalQuestions, 15);
  assert.ok(Array.isArray(correction.correctionDetails));
  assert.equal(correction.correctionDetails.length, 15);
  assert.equal(typeof correction.correctionDetailsPayload, 'object');
  assert.equal(correction.correctionDetailsPayload.correctCount, 15);
  assert.equal(correction.correctionDetailsPayload.questionResults.length, 15);
});

test('OMR confirmation payload can persist answers from legacy correctionDetails list', () => {
  const normalized = examService._normalizePersistableSheetAnswers({
    correctionDetails: [
      {
        questionNumber: 1,
        correctAnswer: 'A',
        studentMarked: 'A',
        isCorrect: true,
        status: 'correct',
        confidence: 0.96,
        earnedPoints: 1,
        maxPoints: 1,
      },
    ],
  });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].markedOption, 'A');
  assert.equal(normalized[0].status, 'ok');
  assert.equal(normalized[0].isCorrect, true);
});

test('OMR v2 exam layout supports dynamic question counts up to 40', () => {
  for (const count of [1, 5, 10, 20, 30, 40]) {
    const layout = examService._buildBubbleSheetOmrLayout({ objectiveQuestionsCount: count });

    assert.equal(layout.version, 'ACADEMYHUB_OMR_V2');
    assert.equal(layout.layoutVersion, 'academyhub-omr-v2');
    assert.equal(layout.totalQuestions, count);
    assert.equal(layout.engine.maxSupportedQuestions, 40);
    assert.equal(layout.engine.supportsDynamicQuestions, true);
    assert.equal(layout.blocks[0].startQuestion, 1);
    assert.equal(layout.blocks.at(-1).endQuestion, count);
  }
});

test('OMR v2 exam layout blocks question counts above 40', () => {
  assert.throws(
    () => examService._buildBubbleSheetOmrLayout({ objectiveQuestionsCount: 41 }),
    /40 questoes/
  );
});

test('OMR v2 Python layout adapter builds one and two column layouts', () => {
  const stdout = runPython(String.raw`
import json
from academyhub_omr_v2.layout_adapter import AcademyHubLayoutAdapter

layout10 = AcademyHubLayoutAdapter.build(10)
layout40 = AcademyHubLayoutAdapter.build(40)
print(json.dumps({
  "q10": {
    "questions": layout10.questions_count,
    "bubbles": len(layout10.bubbles),
    "columns": layout10.debug["columnCount"],
  },
  "q40": {
    "questions": layout40.questions_count,
    "bubbles": len(layout40.bubbles),
    "columns": layout40.debug["columnCount"],
    "rowsPerColumn": layout40.debug["rowsPerColumn"],
  }
}))
`);
  const result = JSON.parse(stdout);

  assert.deepEqual(result.q10, { questions: 10, bubbles: 50, columns: 1 });
  assert.deepEqual(result.q40, { questions: 40, bubbles: 200, columns: 2, rowsPerColumn: 20 });
});

test('OMR v2 runner uses the v2 dynamic layout adapter', () => {
  const stdout = runPython(String.raw`
import json
from academyhub_omr_v2.omr_runner import AcademyHubOmrRunner

layout = AcademyHubOmrRunner._build_layout_attempts(40)[0]
print(json.dumps({
  "questions": layout.questions_count,
  "bubbles": len(layout.bubbles),
  "columns": layout.debug["columnCount"],
  "source": layout.debug["source"],
}))
`);
  const result = JSON.parse(stdout);

  assert.deepEqual(result, {
    questions: 40,
    bubbles: 200,
    columns: 2,
    source: 'generated_adapter_v2',
  });
});

test('OMR v2 Python process returns INVALID_QUESTIONS outside 1..40', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-v2-invalid-'));
  const layoutPath = path.join(tempDir, 'layout.json');
  fs.writeFileSync(layoutPath, JSON.stringify({ totalQuestions: 41 }), 'utf8');

  const result = spawnSync(
    pythonBin(),
    ['src/scripts/process_omr_v2.py', path.join(tempDir, 'missing.jpg'), 'BUBBLE_SHEET', layoutPath],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env },
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseLastJson(result.stdout);
  assert.equal(payload.success, false);
  assert.equal(payload.imageStatus, 'review_required');
  assert.equal(payload.errorCode, 'INVALID_QUESTIONS');
  assert.equal(payload.evaluatedQuestions, 0);
});

test('OMR v2 anchor failure is not reported as blank answers', () => {
  const stdout = runPython(String.raw`
import json
from academyhub_omr_v2.layout_adapter import AcademyHubLayoutAdapter
from academyhub_omr_v2.omr_runner import AcademyHubOmrRunner

layout = AcademyHubLayoutAdapter.build(5)
answers = AcademyHubOmrRunner._build_anchor_failed_answers(layout, "forced failure")
print(json.dumps({
  "statuses": sorted(set(answer["status"] for answer in answers)),
  "debugStatuses": sorted(set(answer["debugStatus"] for answer in answers)),
}))
`);
  const result = JSON.parse(stdout);

  assert.deepEqual(result.statuses, ['not_detected']);
  assert.deepEqual(result.debugStatuses, ['anchor_failed']);
});

test('OMR v2 review_required remains a completed read for the API adapter', () => {
  const stdout = runPython(String.raw`
import json
from process_omr_v2 import is_completed_read, result_image_status

answers = [
  {"question": 1, "status": "ok", "confidence": 0.95},
  {"question": 2, "status": "ambiguous", "confidence": 0.52},
]
image_status = result_image_status(answers, True)
print(json.dumps({
  "imageStatus": image_status,
  "completed": is_completed_read(answers, True, 2, 2, image_status),
}))
`);
  const result = JSON.parse(stdout);

  assert.equal(result.imageStatus, 'review_required');
  assert.equal(result.completed, true);
});

test('OMR v2 low-confidence marked answers require review without dropping answers', () => {
  const stdout = runPython(String.raw`
import json
from process_omr_v2 import is_completed_read, result_image_status

answers = [
  {"question": 1, "status": "ok", "confidence": 0.95},
  {"question": 2, "status": "ok", "confidence": 0.58},
]
image_status = result_image_status(answers, True)
print(json.dumps({
  "imageStatus": image_status,
  "completed": is_completed_read(answers, True, 2, 2, image_status),
}))
`);
  const result = JSON.parse(stdout);

  assert.equal(result.imageStatus, 'review_required');
  assert.equal(result.completed, true);
});

test('OMR v2 empty Python result is not treated as accepted', () => {
  const stdout = runPython(String.raw`
import json
from process_omr_v2 import is_completed_read, result_image_status

image_status = result_image_status([], True)
print(json.dumps({
  "imageStatus": image_status,
  "completed": is_completed_read([], True, 10, 10, image_status),
}))
`);
  const result = JSON.parse(stdout);

  assert.equal(result.imageStatus, 'recapture_required');
  assert.equal(result.completed, false);
});

test('OMR processing service writes v2 compatibility debug artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-v2-debug-'));
  try {
    fs.writeFileSync(path.join(tempDir, '00_input.jpg'), 'image');
    fs.writeFileSync(path.join(tempDir, '02_threshold.jpg'), 'threshold');
    fs.writeFileSync(path.join(tempDir, '03_anchors_detected.jpg'), 'anchors');

    omrProcessingService.writeCompatibilityDebugArtifacts({
      sessionDir: tempDir,
      engineVersion: 'v2',
      result: { success: false, imageStatus: 'recapture_required' },
    });

    assert.equal(fs.existsSync(path.join(tempDir, 'original-received.jpg')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'v2-input.jpg')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'v2-threshold.jpg')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'v2-anchor-overlay.jpg')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'v2-result.json')), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
