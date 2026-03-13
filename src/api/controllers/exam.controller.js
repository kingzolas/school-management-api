const examService = require('../services/exam.service');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const os = require('os');

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
        let tempFilePath = null;
        let tempLayoutPath = null;

        try {
            console.log('\n📸 [POST] /exams/process-omr - ANALISANDO GABARITO PELA IA');

            const { imageBase64, correctionType = 'DIRECT_GRADE', examId } = req.body;
            const schoolId = req.user.school_id;

            if (!imageBase64) throw new Error("Imagem não enviada.");

            console.log(`[INFO] Tipo de Correção Solicitada: ${correctionType}`);
            if (examId) console.log(`[INFO] ID da Prova vinculado: ${examId}`);

            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

            const tempFileName = `temp_${crypto.randomUUID()}.jpg`;
            tempFilePath = path.join(os.tmpdir(), tempFileName);

            fs.writeFileSync(tempFilePath, base64Data, { encoding: 'base64' });

            let omrLayout = null;
            if (correctionType === 'BUBBLE_SHEET' && examId) {
                try {
                    omrLayout = await examService.getExamOmrLayout(examId, schoolId);
                    console.log(`[INFO] Layout OMR carregado da prova ${examId}.`);
                } catch (layoutErr) {
                    console.warn(`⚠️ Falha ao carregar layout OMR da prova: ${layoutErr.message}`);
                }
            }

            const scriptPath = path.join(__dirname, '../../scripts/process_omr.py');

            let command = `python "${scriptPath}" "${tempFilePath}" "${correctionType}"`;

            if (omrLayout) {
                const tempLayoutName = `omr_layout_${crypto.randomUUID()}.json`;
                tempLayoutPath = path.join(os.tmpdir(), tempLayoutName);
                fs.writeFileSync(tempLayoutPath, JSON.stringify(omrLayout, null, 2), 'utf8');

                // O script atual ignora argumentos extras.
                // O próximo script poderá consumir esse 3º argumento sem quebrar compatibilidade.
                command += ` "${tempLayoutPath}"`;
                console.log(`[INFO] Layout OMR temporário salvo em: ${tempLayoutPath}`);
            }

            console.log(`[EXEC] Rodando script: ${command}`);

            exec(command, async (error, stdout, stderr) => {
                try {
                    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    if (tempLayoutPath && fs.existsSync(tempLayoutPath)) fs.unlinkSync(tempLayoutPath);
                } catch (cleanupErr) {
                    console.warn('⚠️ Erro ao limpar arquivos temporários:', cleanupErr.message);
                }

                if (error) {
                    console.error("❌ ERRO NO SCRIPT PYTHON (EXEC):", stderr || error.message);
                    return res.status(200).json({
                        success: false,
                        message: "A IA falhou ao processar o formato da imagem. Tente enquadrar melhor."
                    });
                }

                try {
                    const result = JSON.parse(stdout);
                    console.log("✅ [PYTHON RESPONSE] IA retornou os dados brutos com sucesso.");

                    if (!result.success) {
                        console.error("⚠️ Aviso da IA:", result.message || result.error);
                        return res.status(200).json(result);
                    }

                    if (result.type === 'BUBBLE_SHEET' && examId) {
                        console.log(`[NODE] Iniciando correção baseada no gabarito da Prova ID: ${examId}...`);

                        const exam = await examService.getExamById(examId, schoolId);

                        let totalGrade = 0;
                        let objectiveGrade = 0;
                        const detailedCorrection = [];

                        const objectiveQuestions = exam.questions.filter(q => q.type === 'OBJECTIVE');

                        result.answers.forEach(ans => {
                            const qIndex = ans.question - 1;

                            if (qIndex < objectiveQuestions.length) {
                                const dbQuestion = objectiveQuestions[qIndex];
                                const isCorrect = (ans.marked === dbQuestion.correctAnswer);

                                if (isCorrect) {
                                    objectiveGrade += dbQuestion.weight;
                                    totalGrade += dbQuestion.weight;
                                }

                                detailedCorrection.push({
                                    questionNumber: ans.question,
                                    studentMarked: ans.marked,
                                    correctAnswer: dbQuestion.correctAnswer,
                                    isCorrect,
                                    earnedPoints: isCorrect ? dbQuestion.weight : 0
                                });
                            }
                        });

                        result.grade = totalGrade;
                        result.objectiveGrade = objectiveGrade;
                        result.correctionDetails = detailedCorrection;
                        result.omrLayoutVersion = exam.settings?.omrLayout?.version || null;

                        console.log(`[NODE] Correção finalizada! Nota calculada: ${totalGrade}`);
                        console.log(`[NODE] Detalhes das marcações:`, JSON.stringify(detailedCorrection, null, 2));
                    }

                    console.log("📤 [RESPONSE] Enviando payload final para o App Mobile.");
                    res.status(200).json(result);

                } catch (e) {
                    console.error("❌ Falha crítica ao dar parse no retorno da IA ou calcular gabarito:", stdout);
                    console.error("Detalhe do erro:", e.message);
                    res.status(200).json({
                        success: false,
                        message: "A leitura foi feita, mas houve um erro ao cruzar com o gabarito."
                    });
                }
            });

        } catch (error) {
            try {
                if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                if (tempLayoutPath && fs.existsSync(tempLayoutPath)) fs.unlinkSync(tempLayoutPath);
            } catch (cleanupErr) {
                console.warn('⚠️ Erro ao limpar arquivos temporários no catch principal:', cleanupErr.message);
            }

            console.error('❌ ERRO GERAL NO ENDPOINT DE IMAGEM:', error.message);
            res.status(400).json({ success: false, message: error.message });
        }
    }
}

module.exports = new ExamController();