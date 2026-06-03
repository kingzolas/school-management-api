const examService = require('../services/exam.service');
const omrProcessingService = require('../services/omrProcessing.service');

function getRequestRoles(req) {
    return [
        ...(Array.isArray(req.user?.roles) ? req.user.roles : []),
        req.user?.role,
    ]
        .filter(Boolean)
        .map((role) => String(role).trim().toLowerCase());
}

function hasOmrDebugAccess(req) {
    const configuredToken = omrProcessingService.getDebugToken();
    const requestToken =
        req.headers['x-omr-debug-token'] ||
        req.headers['x-internal-debug-token'] ||
        req.body?.debugToken;

    if (configuredToken && requestToken && String(requestToken) === String(configuredToken)) {
        return true;
    }

    const roles = getRequestRoles(req);
    return roles.some((role) => ['admin', 'coordenador'].includes(role));
}

function buildOmrCaptureMessage(result) {
    if (!result || result.success) {
        return null;
    }

    const hints = Array.isArray(result.captureHints) ? result.captureHints : [];
    if (hints.length > 0) {
        return hints[0];
    }

    if (result.stage === 'sheet_detection') {
        return 'Inclua os quatro cantos pretos dentro da area e mantenha o papel plano.';
    }

    return result.message || 'Nao foi possivel ler o gabarito.';
}

async function resolveOmrContext({ req, examId, qrCodeUuid, schoolId }) {
    let verifiedSheet = null;
    let resolvedExamId = examId;

    if (qrCodeUuid) {
        verifiedSheet = await examService.verifyExamSheet(qrCodeUuid, schoolId);
        if (!resolvedExamId && verifiedSheet?.examId) {
            resolvedExamId = verifiedSheet.examId;
        }
    }

    if (!resolvedExamId) {
        return {
            errorStatus: 400,
            errorPayload: {
                success: false,
                message: 'examId e obrigatorio para leitura do cartao-resposta.',
            },
        };
    }

    const exam = await examService.getExamById(resolvedExamId, schoolId);
    if (!exam) {
        return {
            errorStatus: 404,
            errorPayload: {
                success: false,
                message: 'Prova nao encontrada.',
            },
        };
    }

    return {
        exam,
        examId: resolvedExamId,
        verifiedSheet,
        debugContext: {
            studentId: req.body?.studentId || null,
            studentName: req.body?.studentName || verifiedSheet?.studentName || null,
            examId: String(resolvedExamId),
            examTitle: verifiedSheet?.examTitle || exam.title || null,
            activityId: req.body?.activityId || req.body?.classActivityId || null,
            qrDetected: Boolean(qrCodeUuid),
            qrSource: qrCodeUuid ? 'payload' : null,
        },
    };
}

async function runOmrRequest(req, { persistResults, debugMode }) {
    if (debugMode) {
        if (!omrProcessingService.isDebugEnabled()) {
            return {
                status: 404,
                payload: {
                    success: false,
                    message: 'Debug OMR desativado.',
                },
            };
        }

        if (!hasOmrDebugAccess(req)) {
            return {
                status: 403,
                payload: {
                    success: false,
                    message: 'Acesso ao debug OMR nao autorizado.',
                },
            };
        }
    }

    let sessionDir = null;

    try {
        const {
            imageBase64,
            correctionType = 'DIRECT_GRADE',
            examId,
            qrCodeUuid = null,
        } = req.body;

        const schoolId = req.user.school_id;

        if (!imageBase64) {
            return {
                status: 400,
                payload: {
                    success: false,
                    message: 'Imagem nao enviada.',
                },
            };
        }

        if (correctionType !== 'BUBBLE_SHEET') {
            return {
                status: 400,
                payload: {
                    success: false,
                    message: 'O novo motor OMR atende somente correctionType=BUBBLE_SHEET.',
                },
            };
        }

        const context = await resolveOmrContext({ req, examId, qrCodeUuid, schoolId });
        if (context.errorPayload) {
            return { status: context.errorStatus, payload: context.errorPayload };
        }

        const { exam, examId: resolvedExamId, debugContext } = context;
        const omrLayout = await examService.getExamOmrLayout(resolvedExamId, schoolId);

        const session = omrProcessingService.createDebugSession();
        sessionDir = session.sessionDir;

        const imagePath = omrProcessingService.writeBase64ImageToDisk(imageBase64, sessionDir);
        const layoutPath = omrProcessingService.writeLayoutToDisk(omrLayout, sessionDir);
        const saveImages = debugMode && omrProcessingService.shouldSaveDebugImages();

        const { result } = await omrProcessingService.runPythonOmr({
            imagePath,
            correctionType,
            layoutPath,
            sessionDir,
            saveImages,
        });

        const pipelineDebug = result.debug || {};
        if (debugMode) {
            result.debug = {
                debugId: session.sessionId,
                ...pipelineDebug,
                ...debugContext,
                saveImages,
            };
        } else {
            delete result.debug;
        }

        if (!result.success) {
            const friendlyMessage = buildOmrCaptureMessage(result);
            if (friendlyMessage) {
                result.userMessage = friendlyMessage;
            }

            if (debugMode && saveImages) {
                result.debug.overlays = omrProcessingService.collectImageArtifacts(sessionDir);
            }

            return { status: 200, payload: result };
        }

        const correction = examService.buildBubbleSheetCorrection(exam, result.answers);

        const responsePayload = {
            ...result,
            grade: correction.grade,
            objectiveGrade: correction.objectiveGrade,
            correctionDetails: correction.correctionDetails,
            omrLayoutVersion: exam.settings?.omrLayout?.version || null,
        };

        if (persistResults && qrCodeUuid) {
            const persistedSheet = await examService.scanExamSheet(
                {
                    qrCodeUuid,
                    grade: correction.grade,
                    objectiveGrade: correction.objectiveGrade,
                    answers: correction.persistableAnswers,
                },
                schoolId
            );

            responsePayload.persisted = true;
            responsePayload.sheetId = persistedSheet._id;
            responsePayload.sheetStatus = persistedSheet.status;
        } else {
            responsePayload.persisted = false;
        }

        if (debugMode) {
            responsePayload.academicWriteSkipped = true;
            if (saveImages) {
                responsePayload.debug.overlays = omrProcessingService.collectImageArtifacts(sessionDir);
            }
        }

        return { status: 200, payload: responsePayload };
    } finally {
        if (sessionDir) {
            omrProcessingService.cleanupSession(sessionDir);
        }
    }
}

class ExamController {
    async create(req, res) {
        try {
            const schoolId = req.user.school_id;
            const exam = await examService.createExam(req.body, schoolId);
            res.status(201).json(exam);
        } catch (error) {
            console.error('ERRO AO SALVAR PROVA:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async update(req, res) {
        try {
            const schoolId = req.user.school_id;
            const examId = req.params.id;
            const updatedExam = await examService.updateExam(examId, req.body, schoolId);
            res.status(200).json(updatedExam);
        } catch (error) {
            console.error('ERRO AO ATUALIZAR PROVA:', error.message);
            const normalizedMessage = String(error.message || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();
            if (normalizedMessage.includes('nao pode mais ser alterada')) {
                return res.status(403).json({ message: error.message });
            }
            res.status(400).json({ message: error.message });
        }
    }

    async duplicate(req, res) {
        try {
            const schoolId = req.user.school_id;
            const examId = req.params.id;
            const duplicatedExam = await examService.duplicateExam(examId, schoolId);
            res.status(201).json(duplicatedExam);
        } catch (error) {
            console.error('ERRO AO DUPLICAR PROVA:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async getAll(req, res) {
        try {
            const schoolId = req.user.school_id;
            const exams = await examService.getExams(req.query, schoolId);
            res.status(200).json(exams);
        } catch (error) {
            console.error('ERRO AO BUSCAR PROVAS:', error);
            res.status(500).json({ message: error.message });
        }
    }

    async getById(req, res) {
        try {
            const schoolId = req.user.school_id;
            const exam = await examService.getExamById(req.params.id, schoolId);
            res.status(200).json(exam);
        } catch (error) {
            console.error('ERRO AO BUSCAR PROVA POR ID:', error);
            res.status(404).json({ message: error.message });
        }
    }

    async generateSheets(req, res) {
        try {
            const schoolId = req.user.school_id;
            const examId = req.params.id;
            const { studentIds } = req.body;
            const result = await examService.generateExamSheets(examId, schoolId, studentIds);
            res.status(200).json(result);
        } catch (error) {
            console.error('ERRO AO GERAR LOTE:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async scanSheet(req, res) {
        try {
            const schoolId = req.user.school_id;
            const sheet = await examService.scanExamSheet(req.body, schoolId);
            res.status(200).json({ message: 'Computado com sucesso!', sheet });
        } catch (error) {
            console.error('ERRO AO PROCESSAR RESULTADO:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async verifySheet(req, res) {
        try {
            const schoolId = req.user.school_id;
            const { uuid } = req.params;
            const info = await examService.verifyExamSheet(uuid, schoolId);
            res.status(200).json(info);
        } catch (error) {
            console.error('ERRO AO VERIFICAR QR CODE:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async getSheetsByExam(req, res) {
        try {
            const schoolId = req.user.school_id;
            const examId = req.params.id;
            const result = await examService.getExamSheetsByExamId(examId, schoolId);
            res.status(200).json(result);
        } catch (error) {
            console.error('ERRO AO BUSCAR ALUNOS DA PROVA:', error);
            res.status(404).json({ message: error.message });
        }
    }

    async processOMRImage(req, res) {
        try {
            const { status, payload } = await runOmrRequest(req, {
                persistResults: true,
                debugMode: false,
            });

            return res.status(status).json(payload);
        } catch (error) {
            console.error('ERRO AO PROCESSAR OMR:', error.message);
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }
    }

    async debugOMRImage(req, res) {
        try {
            const { status, payload } = await runOmrRequest(req, {
                persistResults: false,
                debugMode: true,
            });

            return res.status(status).json(payload);
        } catch (error) {
            console.error('ERRO AO PROCESSAR DEBUG OMR:', error.message);
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }
    }
}

module.exports = new ExamController();
