const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEBUG_FILE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.json']);
const DEBUG_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const DEBUG_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ZIP_CRC_TABLE = (() => {
    const table = new Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();

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

    isPerformanceDebugEnabled() {
        return this._envFlag('OMR_PERFORMANCE_DEBUG', false);
    }

    getDebugToken() {
        return process.env.OMR_DEBUG_TOKEN || null;
    }

    getDebugRoot() {
        return path.join(process.cwd(), 'omr_debug');
    }

    getEngineVersion() {
        const raw = String(process.env.OMR_ENGINE_VERSION || 'legacy').trim().toLowerCase();
        if (['legacy', 'v2', 'shadow'].includes(raw)) {
            return raw;
        }
        return 'legacy';
    }

    getPythonTimeoutMs() {
        const value = Number(process.env.OMR_PYTHON_TIMEOUT_MS || 30000);
        return Number.isFinite(value) && value > 0 ? value : 30000;
    }

    getMaxImageBytes() {
        const value = Number(process.env.OMR_MAX_IMAGE_BYTES || 8 * 1024 * 1024);
        return Number.isFinite(value) && value > 0 ? value : 8 * 1024 * 1024;
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
        const debugRoot = this.getDebugRoot();
        this.ensureDir(debugRoot);

        const sessionId = crypto.randomUUID();
        const sessionDir = path.join(debugRoot, sessionId);
        this.ensureDir(sessionDir);

        return {
            sessionId,
            sessionDir,
        };
    }

    writeBase64ImageToDisk(imageBase64, sessionDir, performanceTimings = null) {
        const decodeStart = process.hrtime.bigint();
        const base64Data = String(imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        const maxImageBytes = this.getMaxImageBytes();
        if (imageBuffer.length > maxImageBytes) {
            throw new Error(`Imagem OMR excede o limite de ${maxImageBytes} bytes.`);
        }
        if (performanceTimings) {
            performanceTimings.decodeBase64Ms = this._elapsedMs(decodeStart);
            performanceTimings.imageBytes = imageBuffer.length;
        }

        const writeStart = process.hrtime.bigint();
        const imagePath = path.join(sessionDir, '00_input.jpg');
        fs.writeFileSync(imagePath, imageBuffer);
        if (performanceTimings) {
            performanceTimings.tempImageWriteMs = this._elapsedMs(writeStart);
        }

        return imagePath;
    }

    writeLayoutToDisk(layout, sessionDir) {
        const layoutPath = path.join(sessionDir, 'layout.json');
        fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2), 'utf8');
        return layoutPath;
    }

    runPythonOmr({
        imagePath,
        correctionType,
        layoutPath,
        sessionDir,
        saveImages = false,
        engineVersion = this.getEngineVersion(),
    }) {
        return new Promise((resolve, reject) => {
            const selectedEngine = engineVersion === 'v2' ? 'v2' : 'legacy';
            const scriptName = selectedEngine === 'v2' ? 'process_omr_v2.py' : 'process_omr.py';
            const scriptPath = path.join(process.cwd(), 'src', 'scripts', scriptName);
            const args = [scriptPath, imagePath, correctionType];
            const timeoutMs = this.getPythonTimeoutMs();

            if (layoutPath) {
                args.push(layoutPath);
            }

            this._logInfo('Executando motor Python OMR.', {
                engineVersion: selectedEngine,
                pythonBin: this.pythonBin,
                scriptPath,
                timeoutMs,
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
            let timedOut = false;
            const timeout = setTimeout(() => {
                timedOut = true;
                child.kill('SIGKILL');
            }, timeoutMs);

            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });

            child.on('error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Falha ao iniciar o processo Python: ${error.message}`));
            });

            child.on('close', (code) => {
                clearTimeout(timeout);
                if (timedOut) {
                    return reject(
                        new Error(`Processo Python OMR excedeu timeout de ${timeoutMs}ms.`)
                    );
                }

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

    writeDebugJson(sessionDir, debugPayload) {
        const debugPath = path.join(sessionDir, 'debug.json');
        fs.writeFileSync(debugPath, JSON.stringify(debugPayload, null, 2), 'utf8');
        return debugPath;
    }

    writeManifest(sessionDir, debugId) {
        const manifestPath = path.join(sessionDir, 'manifest.json');
        const generatedAt = new Date().toISOString();
        fs.writeFileSync(
            manifestPath,
            JSON.stringify({ debugId, generatedAt, files: [] }, null, 2),
            'utf8'
        );

        let manifest = {
            debugId,
            generatedAt,
            files: this.listDebugFiles(debugId, { includeManifest: true }),
        };

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        manifest = {
            debugId,
            generatedAt,
            files: this.listDebugFiles(debugId, { includeManifest: true }),
        };
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        return manifest;
    }

    buildArtifactList(debugId) {
        return this.listDebugFiles(debugId, { includeManifest: true });
    }

    listDebugFiles(debugId, { includeManifest = true } = {}) {
        const sessionDir = this.resolveDebugSessionDir(debugId);
        if (!fs.existsSync(sessionDir)) {
            return [];
        }

        return fs
            .readdirSync(sessionDir, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((filename) => {
                if (!includeManifest && filename === 'manifest.json') {
                    return false;
                }
                return this.isAllowedDebugFilename(filename);
            })
            .sort((a, b) => a.localeCompare(b))
            .map((filename) => {
                const filePath = path.join(sessionDir, filename);
                const ext = path.extname(filename).toLowerCase();
                const stat = fs.statSync(filePath);
                return {
                    name: filename,
                    type: DEBUG_IMAGE_EXTENSIONS.has(ext) ? 'image' : 'json',
                    sizeBytes: stat.size,
                    url: `/api/omr/debug/${encodeURIComponent(debugId)}/file/${encodeURIComponent(filename)}`,
                };
            });
    }

    resolveDebugSessionDir(debugId) {
        const normalizedDebugId = this.validateDebugId(debugId);
        const debugRoot = this.getDebugRoot();
        const sessionDir = path.resolve(debugRoot, normalizedDebugId);
        const resolvedRoot = path.resolve(debugRoot);

        if (sessionDir !== resolvedRoot && sessionDir.startsWith(`${resolvedRoot}${path.sep}`)) {
            return sessionDir;
        }

        throw new Error('debugId invalido.');
    }

    resolveDebugFile(debugId, filename) {
        const sessionDir = this.resolveDebugSessionDir(debugId);
        const safeFilename = this.validateDebugFilename(filename);
        const filePath = path.resolve(sessionDir, safeFilename);

        if (!filePath.startsWith(`${sessionDir}${path.sep}`)) {
            throw new Error('Arquivo de debug invalido.');
        }

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return null;
        }

        return {
            filePath,
            filename: safeFilename,
            contentType: this._contentTypeForExtension(path.extname(safeFilename).toLowerCase()),
        };
    }

    validateDebugId(debugId) {
        const normalizedDebugId = String(debugId || '').trim();
        if (
            !normalizedDebugId ||
            normalizedDebugId.includes('..') ||
            normalizedDebugId.includes('/') ||
            normalizedDebugId.includes('\\') ||
            path.isAbsolute(normalizedDebugId) ||
            !DEBUG_ID_PATTERN.test(normalizedDebugId)
        ) {
            throw new Error('debugId invalido.');
        }

        return normalizedDebugId;
    }

    validateDebugFilename(filename) {
        const normalizedFilename = String(filename || '').trim();
        const ext = path.extname(normalizedFilename).toLowerCase();

        if (
            !normalizedFilename ||
            normalizedFilename.includes('..') ||
            normalizedFilename.includes('/') ||
            normalizedFilename.includes('\\') ||
            path.isAbsolute(normalizedFilename) ||
            path.basename(normalizedFilename) !== normalizedFilename ||
            !DEBUG_FILE_EXTENSIONS.has(ext)
        ) {
            throw new Error('Arquivo de debug invalido.');
        }

        return normalizedFilename;
    }

    isAllowedDebugFilename(filename) {
        try {
            this.validateDebugFilename(filename);
            return true;
        } catch (_) {
            return false;
        }
    }

    createDebugZip(debugId) {
        const sessionDir = this.resolveDebugSessionDir(debugId);
        if (!fs.existsSync(sessionDir)) {
            return null;
        }

        const files = this.listDebugFiles(debugId, { includeManifest: true })
            .map((file) => file.name)
            .filter((filename) => this.isAllowedDebugFilename(filename));

        if (!files.length) {
            return null;
        }

        return this._buildStoredZipBuffer(
            files.map((filename) => {
                const filePath = path.join(sessionDir, filename);
                return {
                    name: filename,
                    data: fs.readFileSync(filePath),
                    mtime: fs.statSync(filePath).mtime,
                };
            })
        );
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

    _elapsedMs(startHrtime) {
        return Number(process.hrtime.bigint() - startHrtime) / 1e6;
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
        if (ext === '.json') return 'application/json';
        return 'image/jpeg';
    }

    _crc32(buffer) {
        let crc = 0xffffffff;
        for (const byte of buffer) {
            crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    _dosDateTime(date = new Date()) {
        const year = Math.max(1980, date.getFullYear());
        const dosTime =
            (date.getHours() << 11) |
            (date.getMinutes() << 5) |
            Math.floor(date.getSeconds() / 2);
        const dosDate =
            ((year - 1980) << 9) |
            ((date.getMonth() + 1) << 5) |
            date.getDate();

        return { dosTime, dosDate };
    }

    _buildStoredZipBuffer(files) {
        const localParts = [];
        const centralParts = [];
        let offset = 0;

        for (const file of files) {
            const filenameBuffer = Buffer.from(file.name, 'utf8');
            const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
            const crc = this._crc32(data);
            const { dosTime, dosDate } = this._dosDateTime(file.mtime);

            const localHeader = Buffer.alloc(30);
            localHeader.writeUInt32LE(0x04034b50, 0);
            localHeader.writeUInt16LE(20, 4);
            localHeader.writeUInt16LE(0, 6);
            localHeader.writeUInt16LE(0, 8);
            localHeader.writeUInt16LE(dosTime, 10);
            localHeader.writeUInt16LE(dosDate, 12);
            localHeader.writeUInt32LE(crc, 14);
            localHeader.writeUInt32LE(data.length, 18);
            localHeader.writeUInt32LE(data.length, 22);
            localHeader.writeUInt16LE(filenameBuffer.length, 26);
            localHeader.writeUInt16LE(0, 28);

            localParts.push(localHeader, filenameBuffer, data);

            const centralHeader = Buffer.alloc(46);
            centralHeader.writeUInt32LE(0x02014b50, 0);
            centralHeader.writeUInt16LE(20, 4);
            centralHeader.writeUInt16LE(20, 6);
            centralHeader.writeUInt16LE(0, 8);
            centralHeader.writeUInt16LE(0, 10);
            centralHeader.writeUInt16LE(dosTime, 12);
            centralHeader.writeUInt16LE(dosDate, 14);
            centralHeader.writeUInt32LE(crc, 16);
            centralHeader.writeUInt32LE(data.length, 20);
            centralHeader.writeUInt32LE(data.length, 24);
            centralHeader.writeUInt16LE(filenameBuffer.length, 28);
            centralHeader.writeUInt16LE(0, 30);
            centralHeader.writeUInt16LE(0, 32);
            centralHeader.writeUInt16LE(0, 34);
            centralHeader.writeUInt16LE(0, 36);
            centralHeader.writeUInt32LE(0, 38);
            centralHeader.writeUInt32LE(offset, 42);

            centralParts.push(centralHeader, filenameBuffer);
            offset += localHeader.length + filenameBuffer.length + data.length;
        }

        const localDirectory = Buffer.concat(localParts);
        const centralDirectory = Buffer.concat(centralParts);
        const endRecord = Buffer.alloc(22);
        endRecord.writeUInt32LE(0x06054b50, 0);
        endRecord.writeUInt16LE(0, 4);
        endRecord.writeUInt16LE(0, 6);
        endRecord.writeUInt16LE(files.length, 8);
        endRecord.writeUInt16LE(files.length, 10);
        endRecord.writeUInt32LE(centralDirectory.length, 12);
        endRecord.writeUInt32LE(localDirectory.length, 16);
        endRecord.writeUInt16LE(0, 20);

        return Buffer.concat([localDirectory, centralDirectory, endRecord]);
    }
}

module.exports = new OmrProcessingService();
