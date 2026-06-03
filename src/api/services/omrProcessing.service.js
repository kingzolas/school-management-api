const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

class OmrProcessingService {
    constructor() {
        this.pythonBin = process.env.OMR_PYTHON_BIN || process.env.PYTHON_BIN || 'python3';
    }

    _envFlag(name, defaultValue = false) {
        const value = process.env[name];
        if (value === undefined || value === null || value === '') {
            return defaultValue;
        }
        return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
    }

    isDebugEnabled() {
        return this._envFlag('OMR_DEBUG_ENABLED', false);
    }

    shouldSaveDebugImages() {
        return this._envFlag('OMR_DEBUG_SAVE_IMAGES', false);
    }

    shouldKeepDebugFiles() {
        return this._envFlag('KEEP_OMR_DEBUG_FILES', false);
    }

    getDebugToken() {
        return process.env.OMR_DEBUG_TOKEN || null;
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

    runPythonOmr({ imagePath, correctionType, layoutPath, sessionDir, saveImages = false }) {
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
                    OMR_DEBUG_SAVE_IMAGES: saveImages ? 'true' : 'false',
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
        if (this.shouldKeepDebugFiles()) {
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

    collectImageArtifacts(sessionDir, { includeBase64 = true } = {}) {
        if (!sessionDir || !fs.existsSync(sessionDir)) {
            return [];
        }

        const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
        const artifacts = [];

        const walk = (dirPath) => {
            for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                    continue;
                }

                const ext = path.extname(entry.name).toLowerCase();
                if (!allowedExtensions.has(ext)) {
                    continue;
                }

                const relativePath = path.relative(sessionDir, fullPath).replace(/\\/g, '/');
                const stat = fs.statSync(fullPath);
                const artifact = {
                    name: entry.name,
                    relativePath,
                    size: stat.size,
                    contentType: this._contentTypeForExtension(ext),
                };

                if (includeBase64) {
                    artifact.base64 = fs.readFileSync(fullPath).toString('base64');
                }

                artifacts.push(artifact);
            }
        };

        walk(sessionDir);
        artifacts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        return artifacts;
    }

    _contentTypeForExtension(ext) {
        if (ext === '.png') return 'image/png';
        if (ext === '.webp') return 'image/webp';
        return 'image/jpeg';
    }
}

module.exports = new OmrProcessingService();
