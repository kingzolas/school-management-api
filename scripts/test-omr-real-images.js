const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const examService = require('../src/api/services/exam.service');
const omrProcessingService = require('../src/api/services/omrProcessing.service');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const REPO_ROOT = process.cwd();
const LAB_ROOT = 'C:\\Users\\User\\Documents\\Projetos\\academyhub-omr-lab';
const DEFAULT_SOURCE_DIRS = [
  'C:\\Users\\User\\Downloads\\Teste Gab OMR',
  'C:\\Users\\User\\Downloads\\Teste OMR 2',
  'C:\\Users\\User\\Downloads\\Teste OMR 3',
];

function parseArgs(argv) {
  return {
    strict: !argv.includes('--no-fail'),
    limit: Number(argv.find((item) => item.startsWith('--limit='))?.split('=')[1] || 0),
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeId(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listImagesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const result = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        result.push(fullPath);
      }
    }
  }
  walk(dirPath);
  return result.sort((a, b) => a.localeCompare(b));
}

function buildManifestIndex() {
  const entries = new Map();
  const manifests = [
    path.join(LAB_ROOT, 'fixtures', 'manifest.json'),
    path.join(LAB_ROOT, 'fixtures', 'omr2', 'manifest.json'),
    path.join(LAB_ROOT, 'fixtures', 'omr3', 'manifest.json'),
  ];

  for (const manifestPath of manifests) {
    const manifest = readJsonIfExists(manifestPath);
    if (!manifest || !Array.isArray(manifest.images)) {
      continue;
    }

    for (const image of manifest.images) {
      const sourcePath = path.resolve(image.sourcePath || image.path || '');
      const basename = path.basename(sourcePath).toLowerCase();
      const value = {
        id: image.id || path.parse(sourcePath).name,
        phase: manifestPath.includes(`${path.sep}omr2${path.sep}`) ? 'phase2' : manifestPath.includes(`${path.sep}omr3${path.sep}`) ? 'phase3' : 'phase1',
        questions: Number(image.expectedQuestions || image.questions || 10),
        category: image.category || [],
        template: image.template || null,
        expected: image.expected || null,
      };
      if (sourcePath) {
        entries.set(sourcePath.toLowerCase(), value);
      }
      entries.set(basename, value);
    }
  }

  return entries;
}

function resolveImageMeta(imagePath, manifestIndex) {
  const resolved = path.resolve(imagePath);
  const byPath = manifestIndex.get(resolved.toLowerCase());
  const byName = manifestIndex.get(path.basename(resolved).toLowerCase());
  const known = byPath || byName || {};
  const folder = resolved.includes('Teste OMR 2') ? 'Teste OMR 2' : resolved.includes('Teste OMR 3') ? 'Teste OMR 3' : 'Teste Gab OMR';

  return {
    id: safeId(`${folder}-${known.id || path.parse(resolved).name}`),
    label: `${folder}/${path.basename(resolved)}`,
    path: resolved,
    sourceFolder: folder,
    phase: known.phase || (folder === 'Teste OMR 2' ? 'phase2' : folder === 'Teste OMR 3' ? 'phase3' : 'phase1'),
    questions: Number(known.questions || 10),
    category: known.category || [],
    template: known.template || `omr-${Number(known.questions || 10)}-questions`,
  };
}

function buildMockExam(questions) {
  return {
    correctionType: 'BUBBLE_SHEET',
    totalValue: questions,
    settings: {
      omrLayout: examService._buildBubbleSheetOmrLayout({
        objectiveQuestionsCount: questions,
      }),
    },
    questions: Array.from({ length: questions }, (_, index) => ({
      _id: `q${index + 1}`,
      type: 'OBJECTIVE',
      correctAnswer: ['A', 'B', 'C', 'D', 'E'][index % 5],
      weight: 1,
    })),
  };
}

function buildLayout(questions) {
  return examService._buildBubbleSheetOmrLayout({ objectiveQuestionsCount: questions });
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function extractAnswersMap(result) {
  if (result && result.answersMap && typeof result.answersMap === 'object') {
    return result.answersMap;
  }

  const mapped = {};
  for (const answer of result?.answers || []) {
    const status = String(answer.status || '').toLowerCase();
    if (status === 'multiple') {
      mapped[String(answer.question)] = 'MULTIPLE';
    } else if (status === 'uncertain' || status === 'ambiguous') {
      mapped[String(answer.question)] = 'UNCERTAIN';
    } else if (status === 'blank' || status === 'not_detected') {
      mapped[String(answer.question)] = null;
    } else {
      mapped[String(answer.question)] = answer.marked ?? answer.answer ?? null;
    }
  }
  return mapped;
}

function stageSummary(result) {
  const debug = result?.debug || {};
  const anchorsDebug = debug.anchors || {};
  const anchorsFound = Number(result?.anchorsFound ?? anchorsDebug.found ?? 0);
  const evaluatedQuestions = Number(
    result?.evaluatedQuestions ??
    (result?.success ? result?.questionsCount ?? result?.answers?.length ?? 0 : 0)
  );
  const requestedQuestions = Number(result?.requestedQuestions ?? result?.questionsCount ?? 0);

  return {
    success: Boolean(result?.success),
    imageStatus: result?.imageStatus || (result?.success ? 'accepted' : 'failed'),
    errorCode: result?.errorCode || null,
    stage: result?.stage || null,
    message: result?.message || null,
    anchorsFound,
    anchorDetectionStatus: anchorsFound >= 4 ? 'completed' : 'failed',
    homographyStatus: result?.stage === 'completed' || debug.homography?.applied ? 'completed' : 'skipped',
    bubbleReadStatus: evaluatedQuestions >= requestedQuestions && requestedQuestions > 0 ? 'completed' : 'skipped',
    requestedQuestions,
    detectedQuestions: Number(result?.detectedQuestions ?? result?.questionsCount ?? 0),
    evaluatedQuestions,
    confidence: result?.confidence ?? null,
    warnings: result?.warnings || result?.captureHints || [],
  };
}

function listDebugFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()) || file.endsWith('.json'))
    .sort()
    .map((file) => path.join(dirPath, file));
}

async function runEngine({ imageMeta, engineVersion, runDir }) {
  ensureDir(runDir);
  const imageBuffer = fs.readFileSync(imageMeta.path);
  const base64 = `data:image/${path.extname(imageMeta.path).slice(1).replace('jpg', 'jpeg')};base64,${imageBuffer.toString('base64')}`;
  const performanceTimings = {};
  const imagePath = omrProcessingService.writeBase64ImageToDisk(base64, runDir, performanceTimings);
  const layoutPath = omrProcessingService.writeLayoutToDisk(buildLayout(imageMeta.questions), runDir);
  const inputHashMatches = hashFile(imageMeta.path) === hashFile(imagePath);

  const startedAt = process.hrtime.bigint();
  const { result } = await omrProcessingService.runPythonOmr({
    imagePath,
    correctionType: 'BUBBLE_SHEET',
    layoutPath,
    sessionDir: runDir,
    saveImages: true,
    engineVersion,
  });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  omrProcessingService.writeCompatibilityDebugArtifacts({
    sessionDir: runDir,
    engineVersion,
    result,
  });
  fs.writeFileSync(path.join(runDir, 'api-pipeline-result.json'), JSON.stringify(result, null, 2), 'utf8');

  let correction = null;
  if (result.success) {
    correction = examService.buildBubbleSheetCorrection(buildMockExam(imageMeta.questions), result.answers);
  }

  return {
    engineVersion,
    result: stageSummary(result),
    rawResultPath: path.join(runDir, 'api-pipeline-result.json'),
    debugDir: runDir,
    debugFiles: listDebugFiles(runDir),
    inputHashMatches,
    processingMs: Math.round(elapsedMs * 100) / 100,
    answers: extractAnswersMap(result),
    correction: correction
      ? {
          grade: correction.grade,
          objectiveGrade: correction.objectiveGrade,
          correctionDetailsCount: correction.correctionDetails.length,
          persistableAnswersCount: correction.persistableAnswers.length,
        }
      : null,
  };
}

function compareRuns(legacy, v2) {
  const divergences = [];
  const keys = new Set([...Object.keys(legacy.answers || {}), ...Object.keys(v2.answers || {})]);
  for (const key of [...keys].sort((a, b) => Number(a) - Number(b))) {
    const legacyAnswer = legacy.answers[key] ?? null;
    const v2Answer = v2.answers[key] ?? null;
    if (legacyAnswer !== v2Answer) {
      divergences.push({
        question: Number(key),
        legacy: legacyAnswer,
        v2: v2Answer,
      });
    }
  }
  return divergences;
}

function writeMarkdownReport(summary, reportPath) {
  const lines = [];
  lines.push('# OMR real images diagnosis');
  lines.push('');
  lines.push(`Generated at: ${summary.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Images processed: ${summary.totals.images}`);
  lines.push(`- V2 completed reads: ${summary.totals.v2Completed}`);
  lines.push(`- V2 anchor failures: ${summary.totals.v2AnchorFailures}`);
  lines.push(`- V2 recapture_required: ${summary.totals.v2RecaptureRequired}`);
  lines.push(`- Legacy completed reads: ${summary.totals.legacyCompleted}`);
  lines.push(`- Input hash mismatches: ${summary.totals.inputHashMismatches}`);
  lines.push(`- Answer divergences: ${summary.totals.answerDivergences}`);
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  lines.push('- A imagem entregue ao legado e ao v2 e gravada a partir do mesmo base64 da rota, sem crop/resize no Node.');
  lines.push('- `inputHashMatches=true` confirma que a imagem temporaria e byte-a-byte igual ao arquivo original usado no teste.');
  lines.push('- O v2 deve completar todas as imagens processaveis; `v2AnchorFailures` e `v2RecaptureRequired` precisam ficar em zero neste lote.');
  lines.push('- Divergencias de resposta sao informativas neste script: quando o legado falha antes da leitura e o v2 conclui, as respostas aparecem como divergentes sem indicar regressao do v2.');
  lines.push('- Quando houver falha de ancoras, consulte `v2-threshold.jpg`, `v2-anchor-overlay.jpg` e `v2-result.json` no diretorio de debug indicado.');
  lines.push('');
  lines.push('## Per image');
  lines.push('');
  lines.push('| Image | Questions | Legacy | V2 | V2 anchors | V2 stage | Divergences | Debug |');
  lines.push('| --- | ---: | --- | --- | ---: | --- | ---: | --- |');
  for (const item of summary.images) {
    lines.push(
      `| ${item.label.replace(/\|/g, '/')} | ${item.questions} | ${item.legacy.result.imageStatus}/${item.legacy.result.stage || 'n/a'} | ${item.v2.result.imageStatus}/${item.v2.result.stage || 'n/a'} | ${item.v2.result.anchorsFound} | ${item.v2.result.bubbleReadStatus} | ${item.divergences.length} | ${item.v2.debugDir} |`
    );
  }
  lines.push('');
  ensureDir(path.dirname(reportPath));
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestIndex = buildManifestIndex();
  const images = DEFAULT_SOURCE_DIRS.flatMap(listImagesRecursive)
    .map((imagePath) => resolveImageMeta(imagePath, manifestIndex))
    .filter((item, index, all) => all.findIndex((other) => other.path === item.path) === index);

  const selectedImages = args.limit > 0 ? images.slice(0, args.limit) : images;
  const debugRoot = path.join(REPO_ROOT, 'debug', 'omr-real-images');
  const resultsRoot = path.join(REPO_ROOT, 'results');
  const docsRoot = path.join(REPO_ROOT, 'docs');
  ensureDir(debugRoot);
  ensureDir(resultsRoot);
  ensureDir(docsRoot);

  const summary = {
    generatedAt: new Date().toISOString(),
    strict: args.strict,
    sourceDirs: DEFAULT_SOURCE_DIRS,
    debugRoot,
    totals: {
      images: selectedImages.length,
      legacyCompleted: 0,
      v2Completed: 0,
      v2AnchorFailures: 0,
      v2RecaptureRequired: 0,
      inputHashMismatches: 0,
      answerDivergences: 0,
    },
    images: [],
  };

  for (let index = 0; index < selectedImages.length; index += 1) {
    const imageMeta = selectedImages[index];
    const imageDir = path.join(debugRoot, `${String(index + 1).padStart(2, '0')}-${imageMeta.id}`);
    const legacy = await runEngine({
      imageMeta,
      engineVersion: 'legacy',
      runDir: path.join(imageDir, 'legacy'),
    });
    const v2 = await runEngine({
      imageMeta,
      engineVersion: 'v2',
      runDir: path.join(imageDir, 'v2'),
    });
    const divergences = compareRuns(legacy, v2);

    if (legacy.result.bubbleReadStatus === 'completed') summary.totals.legacyCompleted += 1;
    if (v2.result.bubbleReadStatus === 'completed') summary.totals.v2Completed += 1;
    if (v2.result.anchorsFound < 4) summary.totals.v2AnchorFailures += 1;
    if (v2.result.imageStatus === 'recapture_required') summary.totals.v2RecaptureRequired += 1;
    if (!legacy.inputHashMatches || !v2.inputHashMatches) summary.totals.inputHashMismatches += 1;
    summary.totals.answerDivergences += divergences.length;

    const record = {
      ...imageMeta,
      legacy,
      v2,
      divergences,
    };
    summary.images.push(record);

    console.log(
      `[${index + 1}/${selectedImages.length}] ${imageMeta.label} q=${imageMeta.questions} legacy=${legacy.result.imageStatus}/${legacy.result.bubbleReadStatus} v2=${v2.result.imageStatus}/${v2.result.bubbleReadStatus} anchors=${v2.result.anchorsFound} divergences=${divergences.length}`
    );
  }

  const summaryPath = path.join(resultsRoot, 'omr-real-images-summary.json');
  const reportPath = path.join(docsRoot, 'omr-real-images-diagnosis.md');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  writeMarkdownReport(summary, reportPath);

  console.log('');
  console.log(`Summary: ${summaryPath}`);
  console.log(`Report: ${reportPath}`);
  console.log(`Debug: ${debugRoot}`);

  const hasCriticalFailure =
    summary.totals.inputHashMismatches > 0 ||
    summary.totals.v2AnchorFailures > 0 ||
    summary.totals.v2RecaptureRequired > 0 ||
    summary.totals.v2Completed < summary.totals.images;

  if (args.strict && hasCriticalFailure) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
