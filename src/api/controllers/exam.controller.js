const examService = require('../services/exam.service');
const omrProcessingService = require('../services/omrProcessing.service');

class ExamController {
    async create(req, res) {
        try {
            console.log('\n======================================================');
            console.log('📥 [POST] /exams - SOLICITAÇÃO DE CRIAÇÃO DE PROVA');
            console.log('Payload recebido:', JSON.stringify(req.body, null, 2));

            const schoolId = req.user.school_id;
            const exam = await examService.createExam(req.body, schoolId);

            console.log('✅ Prova salva com sucesso! ID:', exam._id);
            console.log('======================================================\n');

            res.status(201).json(exam);
        } catch (error) {
            console.error('❌ ERRO AO SALVAR PROVA:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async update(req, res) {
        try {
            console.log('\n======================================================');
            console.log(`📥 [PUT] /exams/${req.params.id} - ATUALIZAÇÃO DE PROVA`);

            const schoolId = req.user.school_id;
            const examId = req.params.id;
            const updateData = req.body;

            const updatedExam = await examService.updateExam(examId, updateData, schoolId);

            console.log('✅ Prova atualizada com sucesso!');
            console.log('======================================================\n');

            res.status(200).json(updatedExam);
        } catch (error) {
            console.error('❌ ERRO AO ATUALIZAR PROVA:', error.message);
            if (error.message.includes('não pode mais ser alterada')) {
                return res.status(403).json({ message: error.message });
            }
            res.status(400).json({ message: error.message });
        }
    }

    async duplicate(req, res) {
        try {
            console.log('\n======================================================');
            console.log(`📥 [POST] /exams/${req.params.id}/duplicate - DUPLICAR PROVA`);

            const schoolId = req.user.school_id;
            const examId = req.params.id;

            const duplicatedExam = await examService.duplicateExam(examId, schoolId);

            console.log('✅ Prova duplicada com sucesso! Novo ID:', duplicatedExam._id);
            console.log('======================================================\n');

            res.status(201).json(duplicatedExam);
        } catch (error) {
            console.error('❌ ERRO AO DUPLICAR PROVA:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async getAll(req, res) {
        try {
            const schoolId = req.user.school_id;
            const exams = await examService.getExams(req.query, schoolId);
            res.status(200).json(exams);
        } catch (error) {
            console.error('❌ ERRO AO BUSCAR PROVAS:', error);
            res.status(500).json({ message: error.message });
        }
    }

    async getById(req, res) {
        try {
            const schoolId = req.user.school_id;
            const exam = await examService.getExamById(req.params.id, schoolId);
            res.status(200).json(exam);
        } catch (error) {
            console.error('❌ ERRO AO BUSCAR PROVA POR ID:', error);
            res.status(404).json({ message: error.message });
        }
    }

    async generateSheets(req, res) {
        try {
            console.log('\n======================================================');
            console.log(`📥 [POST] /exams/${req.params.id}/generate-sheets`);

            const schoolId = req.user.school_id;
            const examId = req.params.id;
            const { studentIds } = req.body;

            const result = await examService.generateExamSheets(examId, schoolId, studentIds);

            console.log('✅ Lote de provas gerado com sucesso!');
            console.log(`[INFO] Layout OMR salvo na prova: ${result.omrLayout ? 'SIM' : 'NÃO'}`);
            console.log('======================================================\n');

            res.status(200).json(result);
        } catch (error) {
            console.error('❌ ERRO AO GERAR LOTE:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async scanSheet(req, res) {
        try {
            console.log('\n======================================================');
            console.log('📥 [POST] /exams/scan - LEITURA DE QR CODE (MANUAL/IA)');
            console.log('Payload:', JSON.stringify(req.body, null, 2));

            const schoolId = req.user.school_id;
            const sheet = await examService.scanExamSheet(req.body, schoolId);

            console.log(`✅ Resultados computados para QR Code ${req.body.qrCodeUuid}`);
            console.log('======================================================\n');

            res.status(200).json({ message: 'Computado com sucesso!', sheet });
        } catch (error) {
            console.error('❌ ERRO AO PROCESSAR RESULTADO:', error.message);
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
            console.error('❌ ERRO AO VERIFICAR QR CODE:', error.message);
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
            console.error('❌ ERRO AO BUSCAR ALUNOS DA PROVA:', error);
            res.status(404).json({ message: error.message });
        }
    }

    async processOMRImage(req, res) {
        let sessionDir = null;

        try {
            console.log('\n📸 [POST] /exams/process-omr - ANALISANDO GABARITO PELA IA');

            const {
                imageBase64,
                correctionType = 'DIRECT_GRADE',
                examId,
                qrCodeUuid = null,
            } = req.body;

            const schoolId = req.user.school_id;

            if (!imageBase64) {
                throw new Error('Imagem não enviada.');
            }

            if (correctionType !== 'BUBBLE_SHEET') {
                return res.status(400).json({
                    success: false,
                    message: 'O novo motor OMR atende somente correctionType=BUBBLE_SHEET.',
                });
            }

            if (!examId) {
                return res.status(400).json({
                    success: false,
                    message: 'examId é obrigatório para leitura do cartão-resposta.',
                });
            }

            const exam = await examService.getExamById(examId, schoolId);
            if (!exam) {
                return res.status(404).json({
                    success: false,
                    message: 'Prova não encontrada.',
                });
            }

            const omrLayout = await examService.getExamOmrLayout(examId, schoolId);

            const session = omrProcessingService.createDebugSession();
            sessionDir = session.sessionDir;

            const imagePath = omrProcessingService.writeBase64ImageToDisk(imageBase64, sessionDir);
            const layoutPath = omrProcessingService.writeLayoutToDisk(omrLayout, sessionDir);

            const { result } = await omrProcessingService.runPythonOmr({
                imagePath,
                correctionType,
                layoutPath,
                sessionDir,
            });

            if (!result.success) {
                return res.status(200).json(result);
            }

            const correction = examService.buildBubbleSheetCorrection(exam, result.answers);

            const responsePayload = {
                ...result,
                grade: correction.grade,
                objectiveGrade: correction.objectiveGrade,
                correctionDetails: correction.correctionDetails,
                omrLayoutVersion: exam.settings?.omrLayout?.version || null,
            };

            if (qrCodeUuid) {
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

            return res.status(200).json(responsePayload);
        } catch (error) {
            console.error('❌ ERRO AO PROCESSAR OMR:', error.message);
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        } finally {
            if (sessionDir) {
                omrProcessingService.cleanupSession(sessionDir);
            }
        }
    }
}

module.exports = new ExamController();