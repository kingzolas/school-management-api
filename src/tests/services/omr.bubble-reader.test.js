const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

function pythonBin() {
  return process.env.OMR_PYTHON_BIN || process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
}

function runPython(code, env = {}) {
  const result = spawnSync(pythonBin(), ['-c', code], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
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

test('OMR marks Q5 E when printed bubble borders inflate raw fill ratio but center is much darker', () => {
  const stdout = runPython(String.raw`
import json
from academyhub_omr.bubble_reader import AcademyHubBubbleReader

class Layout:
    choices = ["A", "B", "C", "D", "E"]

reader = AcademyHubBubbleReader(Layout())
details = {
    "A": {"fillRatio": 0.1827, "innerFillRatio": 0.0100, "mean": 184.36, "innerMean": 184.36, "outOfBounds": False},
    "B": {"fillRatio": 0.1746, "innerFillRatio": 0.0000, "mean": 184.03, "innerMean": 184.03, "outOfBounds": False},
    "C": {"fillRatio": 0.1729, "innerFillRatio": 0.0000, "mean": 183.35, "innerMean": 183.35, "outOfBounds": False},
    "D": {"fillRatio": 0.1664, "innerFillRatio": 0.0000, "mean": 184.57, "innerMean": 184.57, "outOfBounds": False},
    "E": {"fillRatio": 0.2251, "innerFillRatio": 0.0800, "mean": 98.11, "innerMean": 98.11, "outOfBounds": False},
}
reader._add_relative_metrics(details)
idx, status, confidence, debug_status, reason = reader._decide_answer(details)
scores = [details[choice]["decisionScore"] for choice in Layout.choices]
decision = reader._build_decision_debug(scores, details)
print(json.dumps({
    "selected": Layout.choices[idx] if idx is not None else None,
    "status": status,
    "debugStatus": debug_status,
    "reason": reason,
    "confidence": confidence,
    "decision": decision,
    "optionE": details["E"],
}))
`);

  const result = JSON.parse(stdout);
  assert.equal(result.selected, 'E');
  assert.equal(result.status, 'ok');
  assert.equal(result.debugStatus, 'marked');
  assert.equal(result.reason, 'center darkness contrast above strong threshold');
  assert.ok(result.optionE.darknessDelta > 80);
});

test('OMR preserves multiple marking detection with two dark centers', () => {
  const stdout = runPython(String.raw`
import json
from academyhub_omr.bubble_reader import AcademyHubBubbleReader

class Layout:
    choices = ["A", "B", "C", "D", "E"]

reader = AcademyHubBubbleReader(Layout())
details = {
    "A": {"fillRatio": 0.2500, "innerFillRatio": 0.1200, "mean": 95.0, "innerMean": 95.0, "outOfBounds": False},
    "B": {"fillRatio": 0.0300, "innerFillRatio": 0.0000, "mean": 184.0, "innerMean": 184.0, "outOfBounds": False},
    "C": {"fillRatio": 0.0300, "innerFillRatio": 0.0000, "mean": 184.0, "innerMean": 184.0, "outOfBounds": False},
    "D": {"fillRatio": 0.0300, "innerFillRatio": 0.0000, "mean": 184.0, "innerMean": 184.0, "outOfBounds": False},
    "E": {"fillRatio": 0.2550, "innerFillRatio": 0.1250, "mean": 94.0, "innerMean": 94.0, "outOfBounds": False},
}
reader._add_relative_metrics(details)
idx, status, confidence, debug_status, reason = reader._decide_answer(details)
print(json.dumps({
    "selected": Layout.choices[idx] if idx is not None else None,
    "status": status,
    "debugStatus": debug_status,
    "reason": reason,
    "confidence": confidence,
}))
`);

  const result = JSON.parse(stdout);
  assert.equal(result.selected, null);
  assert.equal(result.status, 'multiple');
  assert.equal(result.debugStatus, 'multiple');
});

test('production debug fixture 5179 reads expected answers when artifacts are available', { skip: !fs.existsSync(path.join(process.cwd(), 'omr_debug', '5179fa91-42f8-44aa-a9a6-de444d937fec', '00_input.jpg')) }, () => {
  const fixtureDir = path.join(process.cwd(), 'omr_debug', '5179fa91-42f8-44aa-a9a6-de444d937fec');
  const imagePath = path.join(fixtureDir, '00_input.jpg');
  const layoutPath = path.join(fixtureDir, 'layout.json');

  assert.ok(fs.existsSync(layoutPath), 'layout.json do fixture 5179 nao encontrado.');

  const result = spawnSync(pythonBin(), ['src/scripts/process_omr.py', imagePath, 'BUBBLE_SHEET', layoutPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      OMR_DEBUG_SAVE_IMAGES: 'false',
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseLastJson(result.stdout);
  const answers = new Map(payload.answers.map((answer) => [Number(answer.question), answer.marked]));

  assert.equal(answers.get(1), 'C');
  assert.equal(answers.get(2), 'E');
  assert.equal(answers.get(3), 'D');
  assert.equal(answers.get(4), 'C');
  assert.equal(answers.get(5), 'E');

  const question5 = payload.debug.questions.find((question) => Number(question.question) === 5);
  assert.equal(question5.selected, 'E');
  assert.equal(question5.status, 'marked');
});
