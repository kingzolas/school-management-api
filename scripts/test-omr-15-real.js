const fs = require('fs');
const path = require('path');

const omrProcessingService = require('../src/api/services/omrProcessing.service');

const REPO_ROOT = process.cwd();
const CASES = [
  {
    id: 'pen',
    label: '15 questions - pen',
    dir: path.join(REPO_ROOT, 'omr_debug', '246f38a3-017d-4b7b-a8e2-239b3838a7e1'),
  },
  {
    id: 'pencil',
    label: '15 questions - pencil',
    dir: path.join(REPO_ROOT, 'omr_debug', 'db39eb43-08fe-4967-9033-e5e8746210f7'),
  },
];

const EXPECTED_QUESTIONS = 15;
const RESULTS_DIR = path.join(REPO_ROOT, 'results');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const SUMMARY_PATH = path.join(RESULTS_DIR, 'omr-15-real-summary.json');
const DIAGNOSIS_PATH = path.join(DOCS_DIR, 'omr-15-real-diagnosis.md');
const PEN_PENCIL_DIAGNOSIS_PATH = path.join(
  DOCS_DIR,
  'omr-15-questions-pen-pencil-diagnosis.md'
);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hashFile(filePath) {
  return require('crypto').createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function runApiPipeline(caseInfo) {
  const imagePath = path.join(caseInfo.dir, 'original-received.jpg');
  const layoutPath = path.join(caseInfo.dir, 'layout.json');
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Imagem nao encontrada: ${imagePath}`);
  }
  if (!fs.existsSync(layoutPath)) {
    throw new Error(`Layout nao encontrado: ${layoutPath}`);
  }

  const runDir = path.join(REPO_ROOT, 'omr_debug', `15-real-pipeline-${caseInfo.id}`);
  ensureDir(runDir);

  const buffer = fs.readFileSync(imagePath);
  const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  const performanceTimings = {};
  const tempImagePath = omrProcessingService.writeBase64ImageToDisk(
    base64,
    runDir,
    performanceTimings
  );
  const tempLayoutPath = omrProcessingService.writeLayoutToDisk(readJson(layoutPath), runDir);
  const inputHashMatches = hashFile(imagePath) === hashFile(tempImagePath);

  const { result } = await omrProcessingService.runPythonOmr({
    imagePath: tempImagePath,
    correctionType: 'BUBBLE_SHEET',
    layoutPath: tempLayoutPath,
    sessionDir: runDir,
    saveImages: true,
    engineVersion: 'v2',
  });

  omrProcessingService.writeCompatibilityDebugArtifacts({
    sessionDir: runDir,
    engineVersion: 'v2',
    result,
  });

  return {
    ...result,
    apiPipelineDebugDir: runDir,
    inputHashMatches,
    performanceTimings,
  };
}

function answersEqual(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function questionRows(penResult, pencilResult) {
  const rows = [];
  for (let number = 1; number <= EXPECTED_QUESTIONS; number += 1) {
    const penQuestion = penResult.questions.find((question) => Number(question.number) === number) || {};
    const pencilQuestion = pencilResult.questions.find((question) => Number(question.number) === number) || {};
    rows.push({
      question: number,
      pen: penQuestion.selected ?? null,
      penStatus: penQuestion.status || null,
      penConfidence: penQuestion.confidence ?? null,
      pencil: pencilQuestion.selected ?? null,
      pencilStatus: pencilQuestion.status || null,
      pencilConfidence: pencilQuestion.confidence ?? null,
      divergence:
        (penQuestion.selected ?? null) !== (pencilQuestion.selected ?? null) ||
        (penQuestion.status || null) !== (pencilQuestion.status || null),
    });
  }
  return rows;
}

function validateResult(caseInfo, result) {
  const errors = [];
  if (!result.success) {
    errors.push(`${caseInfo.id}: success=false`);
  }
  if (!['accepted', 'review_required'].includes(result.imageStatus)) {
    errors.push(`${caseInfo.id}: imageStatus inesperado ${result.imageStatus}`);
  }
  if (Number(result.requestedQuestions) !== EXPECTED_QUESTIONS) {
    errors.push(`${caseInfo.id}: requestedQuestions=${result.requestedQuestions}`);
  }
  if (Number(result.detectedQuestions) !== EXPECTED_QUESTIONS) {
    errors.push(`${caseInfo.id}: detectedQuestions=${result.detectedQuestions}`);
  }
  if (Number(result.evaluatedQuestions) !== EXPECTED_QUESTIONS) {
    errors.push(`${caseInfo.id}: evaluatedQuestions=${result.evaluatedQuestions}`);
  }
  if (!Array.isArray(result.questions) || result.questions.length !== EXPECTED_QUESTIONS) {
    errors.push(`${caseInfo.id}: questions.length=${result.questions?.length}`);
  }

  const badStatuses = (result.questions || []).filter((question) =>
    ['blank', 'multiple', 'not_detected'].includes(String(question.status || '').toLowerCase())
  );
  if (badStatuses.length) {
    errors.push(
      `${caseInfo.id}: status indevido em questoes ${badStatuses
        .map((question) => `${question.number}:${question.status}`)
        .join(', ')}`
    );
  }
  return errors;
}

function writeReports(summary) {
  ensureDir(RESULTS_DIR);
  ensureDir(DOCS_DIR);
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);

  const lines = [
    '# OMR 15 Questions Pen vs Pencil Diagnosis',
    '',
    `Generated at: ${summary.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Expected questions: ${EXPECTED_QUESTIONS}`,
    `- Pen image status: ${summary.cases.pen.imageStatus}`,
    `- Pencil image status: ${summary.cases.pencil.imageStatus}`,
    `- Pen confidence: ${summary.cases.pen.confidence}`,
    `- Pencil confidence: ${summary.cases.pencil.confidence}`,
    `- Answers equal: ${summary.answersEqual ? 'yes' : 'no'}`,
    `- Passed: ${summary.passed ? 'yes' : 'no'}`,
    '',
    '## Question Comparison',
    '',
    '| Questao | Caneta | Conf. Caneta | Lapis | Conf. Lapis | Divergencia |',
    '|---:|---|---:|---|---:|---|',
    ...summary.questionComparison.map((row) =>
      `| ${row.question} | ${row.pen ?? 'null'} (${row.penStatus}) | ${row.penConfidence} | ${row.pencil ?? 'null'} (${row.pencilStatus}) | ${row.pencilConfidence} | ${row.divergence ? 'sim' : 'nao'} |`
    ),
    '',
    '## Diagnosis',
    '',
    'Os dois artefatos vieram do fluxo real do AcademyHub Mobile Web. O problema observado antes da correcao era falso branco/baixa confianca no lapis quando a marca ficava clara ou fora do miolo da bolha. O layout de 15 questoes estava coerente: requestedQuestions, detectedQuestions e evaluatedQuestions permaneceram em 15.',
    '',
    'A correcao usa evidencia complementar de marca fraca baseada em contraste local e preenchimento do ROI maior da bolha, preservando o innerFillRatio como sinal principal. Isso evita baixar thresholds globais e reduz o risco de transformar bordas, sombra ou sujeira em resposta.',
    '',
  ];

  if (summary.errors.length) {
    lines.push('## Errors', '', ...summary.errors.map((error) => `- ${error}`), '');
  }

  const content = `${lines.join('\n')}\n`;
  fs.writeFileSync(DIAGNOSIS_PATH, content);
  fs.writeFileSync(PEN_PENCIL_DIAGNOSIS_PATH, content);
}

async function main() {
  const results = {};
  const errors = [];
  for (const caseInfo of CASES) {
    const result = await runApiPipeline(caseInfo);
    results[caseInfo.id] = {
      label: caseInfo.label,
      dir: caseInfo.dir,
      apiPipelineDebugDir: result.apiPipelineDebugDir,
      inputHashMatches: result.inputHashMatches,
      success: result.success,
      imageStatus: result.imageStatus,
      requestedQuestions: result.requestedQuestions,
      detectedQuestions: result.detectedQuestions,
      evaluatedQuestions: result.evaluatedQuestions,
      confidence: result.confidence,
      answersMap: result.answersMap,
      questions: result.questions,
      warnings: result.warnings || [],
    };
    if (!result.inputHashMatches) {
      errors.push(`${caseInfo.id}: imagem temporaria da API difere do original-received.jpg`);
    }
    errors.push(...validateResult(caseInfo, result));
  }

  const comparison = questionRows(results.pen, results.pencil);
  const equal = answersEqual(results.pen.answersMap, results.pencil.answersMap);
  if (!equal) {
    errors.push('caneta e lapis retornaram answersMap diferentes');
  }
  const divergentRows = comparison.filter((row) => row.divergence);
  if (divergentRows.length) {
    errors.push(
      `caneta e lapis divergiram por status/resposta nas questoes ${divergentRows
        .map((row) => row.question)
        .join(', ')}`
    );
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    expectedQuestions: EXPECTED_QUESTIONS,
    passed: errors.length === 0,
    answersEqual: equal,
    errors,
    cases: results,
    questionComparison: comparison,
  };
  writeReports(summary);

  console.log(`OMR 15 real: ${summary.passed ? 'OK' : 'FAILED'}`);
  console.log(`- Pen: ${results.pen.imageStatus}, ${results.pen.evaluatedQuestions}/15, confidence ${results.pen.confidence}`);
  console.log(`- Pencil: ${results.pencil.imageStatus}, ${results.pencil.evaluatedQuestions}/15, confidence ${results.pencil.confidence}`);
  console.log(`- Answers equal: ${equal ? 'yes' : 'no'}`);
  console.log(`- Summary: ${SUMMARY_PATH}`);
  console.log(`- Diagnosis: ${DIAGNOSIS_PATH}`);
  console.log(`- Pen/pencil diagnosis: ${PEN_PENCIL_DIAGNOSIS_PATH}`);

  if (!summary.passed) {
    for (const error of errors) {
      console.error(`ERROR: ${error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
