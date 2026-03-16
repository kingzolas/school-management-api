const Exam = require('../models/exam.model');
const ExamSheet = require('../models/exam-sheet.model');
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
        const questions = Array.isArray(exam?.questions) ? exam.questions : [];
        const objectiveQuestions = questions.filter((q) => q && q.type === 'OBJECTIVE');

        this._logInfo('Filtrando questões objetivas da prova.', {
            totalQuestions: questions.length,
            objectiveQuestions: objectiveQuestions.length,
            examId: exam?._id?.toString?.() || null,
        });

        return objectiveQuestions;
    }

    _ensureBubbleSheetSupport(exam) {
        const objectiveQuestions = this._getObjectiveQuestions(exam);

        if (objectiveQuestions.length <= 0) {
            throw new Error('A prova do tipo BUBBLE_SHEET precisa ter ao menos 1 questão objetiva.');
        }

        if (objectiveQuestions.length > 20) {
            throw new Error(
                'A versão atual da leitura OMR suporta até 20 questões objetivas por prova.'
            );
        }

        return objectiveQuestions;
    }

    _buildBubbleSheetOmrLayout({ objectiveQuestionsCount }) {
        const totalQuestions = Number(objectiveQuestionsCount || 0);

        if (totalQuestions <= 0) {
            this._logWarn('Não foi possível construir layout OMR: totalQuestions <= 0.');
            return null;
        }

        if (totalQuestions > 20) {
            throw new Error(
                'A versão atual do layout OMR suporta até 20 questões objetivas.'
            );
        }

        const layout = {
            version: 'ACADEMYHUB_OMR_V1',
            generatedAt: new Date().toISOString(),
            correctionType: 'BUBBLE_SHEET',
            totalQuestions,
            totalOptionsPerQuestion: 5,
            choices: ['A', 'B', 'C', 'D', 'E'],
            engine: {
                name: 'ACADEMYHUB_PYTHON_V1',
                supportsTwoColumns: false,
                maxSupportedQuestions: 20,
            },
        };

        this._logInfo('Layout OMR construído com sucesso.', {
            version: layout.version,
            totalQuestions: layout.totalQuestions,
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

            exam.settings.omrLayout = null;
            return exam;
        }

        const objectiveQuestions = this._ensureBubbleSheetSupport(exam);
        const omrLayout = this._buildBubbleSheetOmrLayout({
            objectiveQuestionsCount: objectiveQuestions.length,
        });

        exam.settings.omrLayout = omrLayout;

        this._logInfo('Layout OMR anexado à prova.', {
            examId: exam._id?.toString?.() || null,
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
            throw new Error('A prova informada não é do tipo BUBBLE_SHEET.');
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

        return exam.settings.omrLayout;
    }

    buildBubbleSheetCorrection(exam, omrAnswers) {
        const objectiveQuestions = this._ensureBubbleSheetSupport(exam);

        let totalGrade = 0;
        let objectiveGrade = 0;
        const correctionDetails = [];
        const persistableAnswers = [];

        for (const answer of omrAnswers || []) {
            const qIndex = Number(answer.question || 0) - 1;
            if (qIndex < 0 || qIndex >= objectiveQuestions.length) {
                continue;
            }

            const dbQuestion = objectiveQuestions[qIndex];
            const markedOption = answer.marked ?? null;
            const correctAnswer = dbQuestion.correctAnswer ?? null;
            const isCorrect = !!markedOption && !!correctAnswer && markedOption === correctAnswer;
            const earnedPoints = isCorrect ? Number(dbQuestion.weight || 0) : 0;

            if (isCorrect) {
                objectiveGrade += earnedPoints;
                totalGrade += earnedPoints;
            }

            correctionDetails.push({
                questionNumber: answer.question,
                questionId: dbQuestion._id,
                studentMarked: markedOption,
                correctAnswer,
                status: answer.status || 'ok',
                confidence: answer.confidence ?? null,
                isCorrect,
                earnedPoints,
            });

            persistableAnswers.push({
                question_id: dbQuestion._id,
                questionNumber: answer.question,
                markedOption,
                correctAnswer,
                status: answer.status || 'ok',
                confidence: answer.confidence ?? null,
                isCorrect,
            });
        }

        return {
            grade: totalGrade,
            objectiveGrade,
            correctionDetails,
            persistableAnswers,
        };
    }

    async verifyExamSheet(qrCodeUuid, schoolId) {
        this._logInfo('Verificando folha de prova por QR Code.', { qrCodeUuid, schoolId });

        const sheet = await ExamSheet.findOne({
            qr_code_uuid: qrCodeUuid,
            school_id: schoolId,
        }).populate('student_id');

        if (!sheet) {
            this._logWarn('QR Code inválido ao verificar folha.', { qrCodeUuid, schoolId });
            throw new Error('QR Code inválido.');
        }

        const exam = await Exam.findById(sheet.exam_id).populate('class_id subject_id');

        return {
            studentName: sheet.student_id.fullName || sheet.student_id.name,
            examTitle: exam.title,
            subjectName: exam.subject_id.name,
            className: exam.class_id.name,
            correctionType: exam.correctionType,
            examVersion: sheet.examVersion || 'STANDARD',
            examId: exam._id,
            hasOmrLayout: !!(exam.settings && exam.settings.omrLayout),
        };
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

        return await exam.save();
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

        return await this.createExam(original, schoolId);
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
            school_id: schoolId,
        }).populate('student_id');

        return {
            examTitle: exam.title,
            correctionType: exam.correctionType,
            sheets: sheets.map((s) => ({
                id: s._id,
                qrCodeUuid: s.qr_code_uuid,
                studentName: s.student_id?.fullName || s.student_id?.name || 'Aluno sem nome',
                status: s.status,
                grade: s.grade,
            })),
        };
    }

    async getExams(query, schoolId) {
        return await Exam.find({ ...query, school_id: schoolId }).populate(
            'class_id subject_id teacher_id'
        );
    }

    async getExamById(id, schoolId) {
        return await Exam.findOne({
            _id: id,
            school_id: schoolId,
        }).populate('class_id subject_id teacher_id');
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

        if (exam.correctionType === 'BUBBLE_SHEET') {
            this._ensureBubbleSheetSupport(exam);
        }

        const enrollments = await Enrollment.find({
            class: exam.class_id._id,
            status: 'Ativa',
        }).populate('student');

        let targetStudents = enrollments.map((e) => e.student).filter(Boolean);

        if (Array.isArray(specificStudentIds) && specificStudentIds.length > 0) {
            const allowedIds = new Set(specificStudentIds.map(String));
            targetStudents = targetStudents.filter((student) =>
                allowedIds.has(String(student._id))
            );
        }

        await this._attachOmrLayoutToExamIfNeeded(exam);
        await exam.save();

        const sheetsCreated = [];

        for (const student of targetStudents) {
            let sheet = await ExamSheet.findOne({
                exam_id: examId,
                student_id: student._id,
            });

            if (!sheet) {
                sheet = new ExamSheet({
                    school_id: schoolId,
                    exam_id: examId,
                    student_id: student._id,
                    qr_code_uuid: crypto.randomUUID(),
                    pdf_generated_at: new Date(),
                });

                await sheet.save();
            }

            sheetsCreated.push({
                qrCodeUuid: sheet.qr_code_uuid,
                studentName: student.fullName,
                gradeName: exam.class_id.name,
            });
        }

        exam.status = 'PRINTED';
        await exam.save();

        return {
            examDetails: exam,
            omrLayout: exam.settings.omrLayout,
            sheets: sheetsCreated,
        };
    }

    async scanExamSheet(payload, schoolId) {
        const { qrCodeUuid, grade, objectiveGrade, answers } = payload;

        const sheet = await ExamSheet.findOneAndUpdate(
            { qr_code_uuid: qrCodeUuid, school_id: schoolId },
            { grade, objectiveGrade, answers, status: 'SCANNED' },
            { new: true }
        );

        if (!sheet) {
            throw new Error('Folha da prova não encontrada.');
        }

        const exam = await Exam.findById(sheet.exam_id);

        if (exam?.settings?.evaluationId) {
            await ClassGrade.findOneAndUpdate(
                {
                    school_id: schoolId,
                    evaluationId: exam.settings.evaluationId,
                    studentId: sheet.student_id,
                },
                {
                    value: grade,
                    dateRecorded: new Date(),
                },
                { upsert: true }
            );
        }

        return sheet;
    }
}

module.exports = new ExamService();