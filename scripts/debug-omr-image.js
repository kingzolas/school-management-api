const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = {
    imagePath: null,
    layoutPath: null,
    questions: Number(process.env.OMR_DEBUG_QUESTIONS || 5),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--layout') {
      args.layoutPath = argv[index + 1];
      index += 1;
    } else if (value === '--questions') {
      args.questions = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--json') {
      args.json = true;
    } else if (!args.imagePath) {
      args.imagePath = value;
    }
  }

  return args;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function extractJson(stdout) {
  const lines = String(stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const jsonLine = [...lines].reverse().find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!jsonLine) {
    throw new Error(`Nenhum JSON encontrado no stdout do Python.\n${stdout}`);
  }

  return JSON.parse(jsonLine);
}

function listOverlayFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  const files = [];
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (allowed.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return files.sort();
}

function formatOptionDetails(question) {
  const options = question.options || {};
  return Object.entries(options)
    .map(([option, data]) => {
      const ratio = data.fillRatio == null ? 'n/a' : Number(data.fillRatio).toFixed(4);
      const mean = data.mean == null ? 'n/a' : Number(data.mean).toFixed(2);
      const bbox = Array.isArray(data.bbox) ? `[${data.bbox.join(',')}]` : 'n/a';
      return `    ${option}: fillRatio=${ratio} mean=${mean} bbox=${bbox}`;
    })
    .join('\n');
}

async function runPython({ imagePath, layoutPath, debugRoot }) {
  const pythonBin =
    process.env.OMR_PYTHON_BIN ||
    process.env.PYTHON_BIN ||
    (process.platform === 'win32' ? 'python' : 'python3');

  const scriptPath = path.join(process.cwd(), 'src', 'scripts', 'process_omr.py');
  const args = [scriptPath, imagePath, 'BUBBLE_SHEET', layoutPath];

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OMR_DEBUG_DIR: debugRoot,
        OMR_DEBUG_SAVE_IMAGES: 'true',
      },
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python finalizou com codigo ${code}.\n${stderr}`));
        return;
      }

      try {
        resolve({ result: extractJson(stdout), stdout, stderr });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.imagePath) {
    throw new Error('Uso: node scripts/debug-omr-image.js ./samples/omr/cartao.jpeg [--questions 5] [--layout ./layout.json]');
  }

  const imagePath = path.resolve(args.imagePath);
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Imagem nao encontrada: ${imagePath}`);
  }

  if (!Number.isInteger(args.questions) || args.questions < 1) {
    throw new Error('--questions precisa ser um inteiro maior que zero.');
  }

  const debugId = `local-${crypto.randomUUID()}`;
  const debugRoot = path.join(process.cwd(), 'omr_debug', debugId);
  ensureDir(debugRoot);

  let layoutPath = args.layoutPath ? path.resolve(args.layoutPath) : null;
  if (!layoutPath) {
    layoutPath = path.join(debugRoot, 'layout.json');
    fs.writeFileSync(
      layoutPath,
      JSON.stringify(
        {
          version: 'LOCAL_DEBUG_MINIMAL',
          correctionType: 'BUBBLE_SHEET',
          totalQuestions: args.questions,
        },
        null,
        2
      )
    );
  }

  const { result } = await runPython({ imagePath, layoutPath, debugRoot });
  const questions = result.debug?.questions || [];

  console.log(`Debug ID: ${debugId}`);
  console.log(`Imagem: ${imagePath}`);
  console.log(`Sucesso: ${result.success === true}`);
  console.log(`Stage: ${result.stage || 'n/a'}`);
  console.log(`Mensagem: ${result.message || 'n/a'}`);
  console.log(`Anchors: ${result.anchorsFound ?? 'n/a'}`);
  console.log(`Layout usado: ${result.debug?.layoutDebug?.source || 'n/a'}`);
  console.log('');

  for (const question of questions) {
    console.log(
      `Q${question.question}: selected=${question.selected || 'null'} status=${question.status} reason=${question.reason}`
    );
    console.log(formatOptionDetails(question));
  }

  if (!questions.length && Array.isArray(result.answers)) {
    for (const answer of result.answers) {
      console.log(
        `Q${answer.question}: marked=${answer.marked || 'null'} status=${answer.status} scores=${JSON.stringify(answer.scores)}`
      );
    }
  }

  const overlays = listOverlayFiles(debugRoot);
  console.log('');
  console.log('Overlays gerados:');
  for (const file of overlays) {
    console.log(`  ${file}`);
  }

  if (args.json) {
    console.log('');
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
