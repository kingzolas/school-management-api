const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

class OmrProcessingService {
    constructor() {
        this.pythonBin = process.env.OMR_PYTHON_BIN || process.env.PYTHON_BIN || 'python3';
        this.keepDebugFiles = String(process.env.KEEP_OMR_DEBUG_FILES || 'true') === 'true';
    }

    _logInfo(message, meta = null) {
        if (meta) {
            console.log(`[OMR SERVICE] ${message}`, meta);
            return;
        }
        console.log(`[OMR SERVICE] ${message}`);
    }

    _logError(message, meta = null) {
        if (meta) {
            console.error(`[OMR SERVICE ERROR] ${message}`, meta);
            return;
        }
        console.error(`[OMR SERVICE ERROR] ${message}`);
    }

    ensureDir(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    createDebugSession() {
        const debugRoot = path.join(process.cwd(), 'omr_debug');
        this.ensureDir(debugRoot);

        const sessionId = crypto.randomUUID();
        const sessionDir = path.join(debugRoot, sessionId);
        this.ensureDir(sessionDir);

        return {
            sessionId,
            sessionDir,
        };
    }

    writeBase64ImageToDisk(imageBase64, sessionDir) {
        const base64Data = String(imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
        const imagePath = path.join(sessionDir, 'input.jpg');
        fs.writeFileSync(imagePath, base64Data, { encoding: 'base64' });
        return imagePath;
    }

    writeLayoutToDisk(layout, sessionDir) {
        const layoutPath = path.join(sessionDir, 'layout.json');
        fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2), 'utf8');
        return layoutPath;
    }

    runPythonOmr({ imagePath, correctionType, layoutPath, sessionDir }) {
        return new Promise((resolve, reject) => {
            const scriptPath = path.join(process.cwd(), 'src', 'scripts', 'process_omr.py');
            const args = [scriptPath, imagePath, correctionType];

            if (layoutPath) {
                args.push(layoutPath);
            }

            this._logInfo('Executando motor Python OMR.', {
                pythonBin: this.pythonBin,
                scriptPath,
                args,
            });

            const child = spawn(this.pythonBin, args, {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    OMR_DEBUG_DIR: sessionDir,
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

            child.on('error', (error) => {
                reject(new Error(`Falha ao iniciar o processo Python: ${error.message}`));
            });

            child.on('close', (code) => {
                if (code !== 0) {
                    return reject(
                        new Error(
                            `Processo Python finalizou com código ${code}. STDERR: ${stderr || 'vazio'}`
                        )
                    );
                }

                try {
                    const parsed = this._extractJson(stdout);
                    resolve({
                        result: parsed,
                        stdout,
                        stderr,
                    });
                } catch (error) {
                    reject(
                        new Error(
                            `Falha ao interpretar JSON do Python. STDOUT: ${stdout} | STDERR: ${stderr} | Erro: ${error.message}`
                        )
                    );
                }
            });
        });
    }

    cleanupSession(sessionDir) {
        if (this.keepDebugFiles) {
            return;
        }

        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
            this._logError('Falha ao limpar diretório temporário OMR.', {
                sessionDir,
                error: error.message,
            });
        }
    }

    _extractJson(stdout) {
        const lines = String(stdout)
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        const jsonLine = [...lines]
            .reverse()
            .find((line) => line.startsWith('{') && line.endsWith('}'));

        if (!jsonLine) {
            throw new Error('Nenhuma linha JSON encontrada no stdout.');
        }

        return JSON.parse(jsonLine);
    }
}

module.exports = new OmrProcessingService();