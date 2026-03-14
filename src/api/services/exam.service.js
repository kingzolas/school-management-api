const Exam = require('../models/exam.model');
const ExamSheet = require('../models/exam-sheet.model');
const Student = require('../models/student.model');
const Enrollment = require('../models/enrollment.model');
const Evaluation = require('../models/evaluation.model');
const ClassGrade = require('../models/grade.model');
const crypto = require('crypto');

class ExamService {
    _logInfo(message, meta = null) {
        if (meta) {
            console.log(`[EXAM SERVICE] ${message}`, meta);
            return;
        }
        console.log(`[EXAM SERVICE] ${message}`);
    }

    _logWarn(message, meta = null) {
        if (meta) {
            console.warn(`[EXAM SERVICE WARN] ${message}`, meta);
            return;
        }
        console.warn(`[EXAM SERVICE WARN] ${message}`);
    }

    _logError(message, meta = null) {
        if (meta) {
            console.error(`[EXAM SERVICE ERROR] ${message}`, meta);
            return;
        }
        console.error(`[EXAM SERVICE ERROR] ${message}`);
    }

    _getObjectiveQuestions(exam) {
        const questions = Array.isArray(exam.questions) ? exam.questions : [];
        const objectiveQuestions = questions.filter(q => q && q.type === 'OBJECTIVE');

        this._logInfo('Filtrando questões objetivas da prova.', {
            totalQuestions: questions.length,
            objectiveQuestions: objectiveQuestions.length,
            examId: exam?._id?.toString?.() || null,
        });

        return objectiveQuestions;
    }

    _buildBubbleSheetOmrLayout({ objectiveQuestionsCount }) {
        const totalQuestions = Number(objectiveQuestionsCount || 0);

        this._logInfo('Construindo layout OMR da prova.', {
            objectiveQuestionsCount,
            totalQuestions,
        });

        if (totalQuestions <= 0) {
            this._logWarn('Não foi possível construir layout OMR: totalQuestions <= 0.');
            return null;
        }

        const hasTwoColumns = totalQuestions > 20;
        const questionsPerColumn = hasTwoColumns ? 20 : totalQuestions;
        const columnCount = hasTwoColumns ? 2 : 1;

        const canonicalWidth = 1000;
        const canonicalHeight = 1400;

        const anchors = {
            topLeft: { x: 60, y: 60 },
            topRight: { x: 940, y: 60 },
            bottomRight: { x: 940, y: 1340 },
            bottomLeft: { x: 60, y: 1340 },
        };

        // =====================================================
        // MATEMÁTICA EXATA DO FLUTTER (V10)
        // Mantida porque o layout do seu gabarito não mudou.
        // A mudança está somente no Python, na forma de leitura.
        // =====================================================

        let flutterMachineHeight = 18 + 18 + (questionsPerColumn * 17) + 16 + 28;
        if (flutterMachineHeight < 155) flutterMachineHeight = 155;
        const flutterMachineWidth = 265;

        const physicalAnchorDistX = flutterMachineWidth - 26;
        const physicalAnchorDistY = flutterMachineHeight - 26;

        const ratioX = (940 - 60) / physicalAnchorDistX;
        const ratioY = (1340 - 60) / physicalAnchorDistY;

        const toCanonX = (flutterX) => Math.round(60 + ((flutterX - 13) * ratioX));
        const toCanonY = (flutterY) => Math.round(60 + ((flutterY - 13) * ratioY));

        const leftBlockWidth = 114;
        const physicalFirstBubbleX = leftBlockWidth + 39;
        const physicalBubbleStepX = 16;

        const physicalRowStartY = 44.5;
        const physicalRowStepY = 17;

        const leftColumn = {
            firstBubbleX: toCanonX(physicalFirstBubbleX),
            bubbleStepX: Math.round(physicalBubbleStepX * ratioX),
            rowStartY: toCanonY(physicalRowStartY),
            rowStepY: physicalRowStepY * ratioY,
        };

        const rightColumn = {
            firstBubbleX: toCanonX(physicalFirstBubbleX + 130),
            bubbleStepX: leftColumn.bubbleStepX,
            rowStartY: leftColumn.rowStartY,
            rowStepY: leftColumn.rowStepY,
        };

        const answerRegion = {
            x1: toCanonX(leftBlockWidth),
            y1: toCanonY(20),
            x2: toCanonX(flutterMachineWidth - 10),
            y2: toCanonY(flutterMachineHeight - 10),
        };

        const bubbleRadius = 12;
        const optionLabels = ['A', 'B', 'C', 'D', 'E'];
        const bubbles = [];

        for (let q = 1; q <= totalQuestions; q++) {
            const isSecond = q > 20;
            const geom = isSecond ? rightColumn : leftColumn;
            const rowIndex = isSecond ? (q - 21) : (q - 1);
            const cy = Math.round(geom.rowStartY + (rowIndex * geom.rowStepY));

            for (let optIndex = 0; optIndex < optionLabels.length; optIndex++) {
                bubbles.push({
                    question: q,
                    option: optionLabels[optIndex],
                    columnIndex: isSecond ? 1 : 0,
                    rowIndex,
                    x: geom.firstBubbleX + (optIndex * geom.bubbleStepX),
                    y: cy,
                    r: bubbleRadius,
                });
            }
        }

        const layout = {
            version: 'OMR_BUBBLE_SHEET_V11_CONTOUR_PATCH',
            generatedAt: new Date().toISOString(),
            correctionType: 'BUBBLE_SHEET',
            canonicalWidth,
            canonicalHeight,
            totalQuestions,
            totalOptionsPerQuestion: 5,
            hasTwoColumns,
            columnCount,
            questionsPerColumn,
            bubbleRadius,
            bubbleDiameter: bubbleRadius * 2,
            anchors,
            answerRegion,
            bubbles,
            readStrategy: {
                detector: 'CONTOUR_TEMPLATE_MATCHING',
                answerDecision: 'DARKEST_PATCH_WITH_RATIO',
                ratioThreshold: 0.78,
            },
        };

        this._logInfo('Layout OMR construído com sucesso.', {
            version: layout.version,
            totalQuestions: layout.totalQuestions,
            columnCount: layout.columnCount,
            questionsPerColumn: layout.questionsPerColumn,
            bubbleCount: layout.bubbles.length,
            canonicalWidth: layout.canonicalWidth,
            canonicalHeight: layout.canonicalHeight,
        });

        return layout;
    }

    async _attachOmrLayoutToExamIfNeeded(exam) {
        if (!exam) {
            this._logWarn('_attachOmrLayoutToExamIfNeeded chamado sem exam.');
            return exam;
        }

        exam.settings = exam.settings || {};

        if (exam.correctionType !== 'BUBBLE_SHEET') {
            this._logInfo('Prova não é do tipo BUBBLE_SHEET. Limpando layout OMR se existir.', {
                examId: exam._id?.toString?.() || null,
                correctionType: exam.correctionType,
            });

            if (exam.settings.omrLayout) delete exam.settings.omrLayout;
            return exam;
        }

        const objectiveQuestions = this._getObjectiveQuestions(exam);
        const omrLayout = this._buildBubbleSheetOmrLayout({
            objectiveQuestionsCount: objectiveQuestions.length
        });

        exam.settings.omrLayout = omrLayout;

        this._logInfo('Layout OMR anexado à prova.', {
            examId: exam._id?.toString?.() || null,
            correctionType: exam.correctionType,
            totalObjectiveQuestions: objectiveQuestions.length,
            hasLayout: !!omrLayout,
        });

        return exam;
    }

    async getExamOmrLayout(examId, schoolId) {
        this._logInfo('Buscando layout OMR da prova.', { examId, schoolId });

        const exam = await Exam.findOne({ _id: examId, school_id: schoolId });
        if (!exam) {
            this._logError('Prova não encontrada ao buscar layout OMR.', { examId, schoolId });
            throw new Error('Prova não encontrada.');
        }

        if (exam.correctionType !== 'BUBBLE_SHEET') {
            this._logWarn('Tentativa de obter layout OMR para prova de tipo incorreto.', {
                examId,
                correctionType: exam.correctionType,
            });
            throw new Error('Tipo incorreto.');
        }

        exam.settings = exam.settings || {};

        if (!exam.settings.omrLayout) {
            this._logWarn('Prova sem layout OMR persistido. Gerando automaticamente.', {
                examId,
                schoolId,
            });
            await this._attachOmrLayoutToExamIfNeeded(exam);
            await exam.save();
        }

        this._logInfo('Layout OMR retornado com sucesso.', {
            examId,
            version: exam.settings?.omrLayout?.version || null,
            totalQuestions: exam.settings?.omrLayout?.totalQuestions || 0,
        });

        return exam.settings.omrLayout;
    }

    async verifyExamSheet(qrCodeUuid, schoolId) {
        this._logInfo('Verificando folha de prova por QR Code.', { qrCodeUuid, schoolId });

        const sheet = await ExamSheet.findOne({
            qr_code_uuid: qrCodeUuid,
            school_id: schoolId
        }).populate('student_id');

        if (!sheet) {
            this._logWarn('QR Code inválido ao verificar folha.', { qrCodeUuid, schoolId });
            throw new Error('QR Code inválido.');
        }

        const exam = await Exam.findById(sheet.exam_id).populate('class_id subject_id');

        const response = {
            studentName: sheet.student_id.fullName || sheet.student_id.name,
            examTitle: exam.title,
            subjectName: exam.subject_id.name,
            className: exam.class_id.name,
            correctionType: exam.correctionType,
            examVersion: sheet.examVersion || 'STANDARD',
            examId: exam._id,
            hasOmrLayout: !!(exam.settings && exam.settings.omrLayout)
        };

        this._logInfo('Folha verificada com sucesso.', {
            qrCodeUuid,
            examId: exam._id?.toString?.(),
            studentId: sheet.student_id?._id?.toString?.(),
            correctionType: exam.correctionType,
            hasOmrLayout: response.hasOmrLayout,
        });

        return response;
    }

    async createExam(data, schoolId) {
        this._logInfo('Criando prova.', {
            schoolId,
            title: data?.title,
            correctionType: data?.correctionType,
        });

        const exam = new Exam({ ...data, school_id: schoolId });

        await this._attachOmrLayoutToExamIfNeeded(exam);

        const savedExam = await exam.save();

        this._logInfo('Prova salva com sucesso.', {
            examId: savedExam._id?.toString?.(),
            title: savedExam.title,
            correctionType: savedExam.correctionType,
            hasOmrLayout: !!savedExam?.settings?.omrLayout,
        });

        try {
            const evaluation = new Evaluation({
                school_id: schoolId,
                class_id: savedExam.class_id,
                subject_id: savedExam.subject_id,
                title: savedExam.title,
                type: 'EXAM',
                date: savedExam.applicationDate,
                maxScore: savedExam.totalValue,
            });

            const savedEval = await evaluation.save();

            savedExam.settings = savedExam.settings || {};
            savedExam.settings.evaluationId = savedEval._id;
            await savedExam.save();

            this._logInfo('Evaluation vinculada à prova com sucesso.', {
                examId: savedExam._id?.toString?.(),
                evaluationId: savedEval._id?.toString?.(),
            });
        } catch (e) {
            this._logWarn('Falha ao criar/vincular evaluation da prova.', {
                examId: savedExam._id?.toString?.(),
                error: e?.message || String(e),
            });
        }

        return savedExam;
    }

    async updateExam(examId, updateData, schoolId) {
        this._logInfo('Atualizando prova.', { examId, schoolId });

        const exam = await Exam.findOne({ _id: examId, school_id: schoolId });
        if (!exam) {
            this._logError('Prova não encontrada para atualização.', { examId, schoolId });
            throw new Error('Prova não encontrada.');
        }

        Object.assign(exam, updateData);

        await this._attachOmrLayoutToExamIfNeeded(exam);

        const saved = await exam.save();

        this._logInfo('Prova atualizada com sucesso.', {
            examId: saved._id?.toString?.(),
            correctionType: saved.correctionType,
            hasOmrLayout: !!saved?.settings?.omrLayout,
        });

        return saved;
    }

    async duplicateExam(examId, schoolId) {
        this._logInfo('Duplicando prova.', { examId, schoolId });

        const original = await Exam.findOne({ _id: examId, school_id: schoolId }).lean();
        if (!original) {
            this._logError('Prova original não encontrada para duplicação.', { examId, schoolId });
            throw new Error('Prova não encontrada.');
        }

        delete original._id;
        original.title += ' [Cópia]';

        const duplicated = await this.createExam(original, schoolId);

        this._logInfo('Prova duplicada com sucesso.', {
            originalExamId: examId,
            newExamId: duplicated._id?.toString?.(),
        });

        return duplicated;
    }

    async getExamSheetsByExamId(examId, schoolId) {
        this._logInfo('Buscando folhas da prova.', { examId, schoolId });

        const exam = await Exam.findOne({ _id: examId, school_id: schoolId });
        if (!exam) {
            this._logError('Prova não encontrada ao listar folhas.', { examId, schoolId });
            throw new Error('Prova não encontrada.');
        }

        const sheets = await ExamSheet.find({
            exam_id: examId,
            school_id: schoolId
        }).populate('student_id');

        const response = {
            examTitle: exam.title,
            correctionType: exam.correctionType,
            sheets: sheets.map(s => ({
                id: s._id,
                qrCodeUuid: s.qr_code_uuid,
                studentName: s.student_id?.fullName || s.student_id?.name || 'Aluno sem nome',
                status: s.status,
                grade: s.grade
            }))
        };

        this._logInfo('Folhas da prova carregadas.', {
            examId,
            totalSheets: response.sheets.length,
            correctionType: response.correctionType,
        });

        return response;
    }

    async getExams(query, schoolId) {
        this._logInfo('Listando provas.', { schoolId, query });
        const exams = await Exam.find({ ...query, school_id: schoolId }).populate('class_id subject_id teacher_id');
        this._logInfo('Provas listadas com sucesso.', { schoolId, total: exams.length });
        return exams;
    }

    async getExamById(id, schoolId) {
        this._logInfo('Buscando prova por ID.', { id, schoolId });

        const exam = await Exam.findOne({
            _id: id,
            school_id: schoolId
        }).populate('class_id subject_id teacher_id');

        if (!exam) {
            this._logWarn('Prova não encontrada por ID.', { id, schoolId });
        } else {
            this._logInfo('Prova encontrada por ID.', {
                id,
                title: exam.title,
                correctionType: exam.correctionType,
            });
        }

        return exam;
    }

    async generateExamSheets(examId, schoolId, specificStudentIds = []) {
        this._logInfo('Gerando folhas da prova.', {
            examId,
            schoolId,
            specificStudentIdsCount: Array.isArray(specificStudentIds) ? specificStudentIds.length : 0,
        });

        const exam = await this.getExamById(examId, schoolId);
        if (!exam) {
            this._logError('Prova não encontrada ao gerar folhas.', { examId, schoolId });
            throw new Error('Prova não encontrada.');
        }

        const enrollments = await Enrollment.find({
            class: exam.class_id._id,
            status: 'Ativa'
        }).populate('student');

        let targetStudents = enrollments.map(e => e.student).filter(s => s != null);

        if (Array.isArray(specificStudentIds) && specificStudentIds.length > 0) {
            const allowedIds = new Set(specificStudentIds.map(String));
            targetStudents = targetStudents.filter(student => allowedIds.has(String(student._id)));
        }

        this._logInfo('Alunos elegíveis para geração de folhas.', {
            examId,
            totalEnrollments: enrollments.length,
            totalTargetStudents: targetStudents.length,
        });

        await this._attachOmrLayoutToExamIfNeeded(exam);
        await exam.save();

        const sheetsCreated = [];

        for (const student of targetStudents) {
            let sheet = await ExamSheet.findOne({
                exam_id: examId,
                student_id: student._id
            });

            if (!sheet) {
                sheet = new ExamSheet({
                    school_id: schoolId,
                    exam_id: examId,
                    student_id: student._id,
                    qr_code_uuid: crypto.randomUUID(),
                    pdf_generated_at: new Date()
                });

                await sheet.save();

                this._logInfo('Nova folha criada.', {
                    examId,
                    studentId: student._id?.toString?.(),
                    qrCodeUuid: sheet.qr_code_uuid,
                });
            } else {
                this._logInfo('Folha já existente reutilizada.', {
                    examId,
                    studentId: student._id?.toString?.(),
                    qrCodeUuid: sheet.qr_code_uuid,
                });
            }

            sheetsCreated.push({
                qrCodeUuid: sheet.qr_code_uuid,
                studentName: student.fullName,
                gradeName: exam.class_id.name
            });
        }

        exam.status = 'PRINTED';
        await exam.save();

        this._logInfo('Geração de folhas concluída.', {
            examId,
            totalSheets: sheetsCreated.length,
            layoutVersion: exam?.settings?.omrLayout?.version || null,
        });

        return {
            examDetails: exam,
            omrLayout: exam.settings.omrLayout,
            sheets: sheetsCreated
        };
    }

    async scanExamSheet(payload, schoolId) {
        const { qrCodeUuid, grade, objectiveGrade, answers } = payload;

        this._logInfo('Persistindo leitura da folha escaneada.', {
            schoolId,
            qrCodeUuid,
            grade,
            objectiveGrade,
            answersCount: Array.isArray(answers) ? answers.length : 0,
        });

        const sheet = await ExamSheet.findOneAndUpdate(
            { qr_code_uuid: qrCodeUuid, school_id: schoolId },
            { grade, objectiveGrade, answers, status: 'SCANNED' },
            { new: true }
        );

        if (!sheet) {
            this._logError('Folha não encontrada ao salvar leitura.', {
                qrCodeUuid,
                schoolId,
            });
            throw new Error('Folha da prova não encontrada.');
        }

        const exam = await Exam.findById(sheet.exam_id);

        if (exam?.settings?.evaluationId) {
            await ClassGrade.findOneAndUpdate(
                {
                    school_id: schoolId,
                    evaluationId: exam.settings.evaluationId,
                    studentId: sheet.student_id
                },
                {
                    value: grade,
                    dateRecorded: new Date()
                },
                { upsert: true }
            );

            this._logInfo('Nota sincronizada em ClassGrade.', {
                schoolId,
                evaluationId: exam.settings.evaluationId?.toString?.(),
                studentId: sheet.student_id?.toString?.(),
                grade,
            });
        } else {
            this._logWarn('A prova escaneada não possui evaluationId vinculado.', {
                examId: exam?._id?.toString?.(),
                qrCodeUuid,
            });
        }

        this._logInfo('Leitura da folha persistida com sucesso.', {
            qrCodeUuid,
            sheetId: sheet._id?.toString?.(),
            examId: exam?._id?.toString?.(),
            grade,
            objectiveGrade,
        });

        return sheet;
    }
}

module.exports = new ExamService();