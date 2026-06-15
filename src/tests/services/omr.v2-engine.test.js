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
