const Exam = require('../models/exam.model');
const ExamSheet = require('../models/exam-sheet.model');
const Enrollment = require('../models/enrollment.model');
const Evaluation = require('../models/evaluation.model');
const ClassGrade = require('../models/grade.model');
const Class = require('../models/class.model');
const mongoose = require('mongoose');
const crypto = require('crypto');
const {
    ensureClassAccess,
    isPrivilegedActor,
    extractId,
    createHttpError,
} = require('./classAccess.service');

const getObjectIdString = (value) => {
    if (!value) return '';
    if (value._id) return String(value._id);
    return String(value);
};

const toBooleanQuery = (value) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null) return false;
    return ['true', '1', 'yes', 'sim'].includes(String(value).toLowerCase());
};

class ExamService {
    _ensureValidObjectId(value, label) {
        if (!value || !mongoose.Types.ObjectId.isValid(value)) {
            throw createHttpError(`${label} invalido.`, 400);
        }
    }

    async _getReadableExam(examId, schoolId, actor) {
        this._ensureValidObjectId(examId, 'ID da prova');

        const exam = await Exam.findOne({ _id: examId, school_id: schoolId })
            .populate('class_id', 'name school_id')
            .populate('subject_id', 'name')
            .populate('teacher_id', 'fullName name')
            .lean();

        if (!exam) {
            throw createHttpError('Prova nao encontrada.', 404);
        }

        const classId = getObjectIdString(exam.class_id);
        await ensureClassAccess(actor, schoolId, classId);

        if (!isPrivilegedActor(actor)) {
            const actorId = extractId(actor?.id || actor?._id);
            const examTeacherId = getObjectIdString(exam.teacher_id);
            if (!actorId || actorId !== examTeacherId) {
                throw createHttpError('Prova nao encontrada ou sem permissao de acesso.', 404);
            }
        }

        return exam;
    }

    _normalizeStoredAnswer(answer, examQuestion = null) {
        const rawNumber = answer?.questionNumber ?? answer?.question ?? null;
        const questionNumber = Number(rawNumber);
        const markedOption =
            answer?.markedOption ?? answer?.studentAnswer ?? answer?.studentMarked ?? null;
        const correctAnswer = answer?.correctAnswer ?? examQuestion?.correctAnswer ?? null;
        const rawStatus = String(answer?.status || '').trim().toLowerCase();
        const hasCorrectness = typeof answer?.isCorrect === 'boolean';

        let status = 'unavailable';
        if (rawStatus === 'blank' || !markedOption) {
            status = 'blank';
        } else if (rawStatus === 'multiple' || rawStatus === 'ambiguous') {
            status = rawStatus;
        } else if (hasCorrectness) {
            status = answer.isCorrect ? 'correct' : 'incorrect';
        } else if (rawStatus) {
            status = rawStatus;
        }

        return {
            questionNumber: Number.isFinite(questionNumber) ? questionNumber : null,
            markedOption: markedOption || null,
            correctAnswer: correctAnswer || null,
            isCorrect: hasCorrectness ? answer.isCorrect : null,
            status,
            confidence: typeof answer?.confidence === 'number' ? answer.confidence : null,
            maxPoints: typeof examQuestion?.weight === 'number' ? examQuestion.weight : null,
        };
    }

    _buildStoredAnswerSummary(sheet, exam) {
        const answers = Array.isArray(sheet?.answers) ? sheet.answers : [];
        if (answers.length === 0 || exam.correctionType !== 'BUBBLE_SHEET') {
            return {
                correctAnswers: null,
                wrongAnswers: null,
                blankAnswers: null,
                detailsAvailable: false,
            };
        }

        const normalized = answers.map((answer) => {
            const number = Number(answer?.questionNumber ?? answer?.question ?? 0);
            const examQuestion = Number.isFinite(number) && number > 0
                ? exam.questions?.[number - 1] || null
                : null;
            return this._normalizeStoredAnswer(answer, examQuestion);
        });

        return {
            correctAnswers: normalized.filter((answer) => answer.status === 'correct').length,
            wrongAnswers: normalized.filter((answer) =>
                ['incorrect', 'multiple', 'ambiguous'].includes(answer.status)
            ).length,
            blankAnswers: normalized.filter((answer) => answer.status === 'blank').length,
            detailsAvailable: normalized.length > 0,
        };
    }

    _finiteNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

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
                debugStatus: answer.debugStatus || null,
                reason: answer.reason || null,
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
                debugStatus: answer.debugStatus || null,
                reason: answer.reason || null,
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

        const omrLayout = exam.settings?.omrLayout || null;
        const objectiveQuestionsCount = Array.isArray(exam.questions)
            ? exam.questions.filter((question) => question?.type === 'OBJECTIVE').length
            : null;

        return {
            studentName: sheet.student_id.fullName || sheet.student_id.name,
            examTitle: exam.title,
            subjectName: exam.subject_id.name,
            className: exam.class_id.name,
            correctionType: exam.correctionType,
            examVersion: sheet.examVersion || 'STANDARD',
            examId: exam._id,
            hasOmrLayout: !!omrLayout,
            totalQuestions: omrLayout?.totalQuestions ?? objectiveQuestionsCount,
            totalOptionsPerQuestion: omrLayout?.totalOptionsPerQuestion ?? null,
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

    async _ensureClassBelongsToSchool(classId, schoolId) {
        const normalizedClassId = getObjectIdString(classId);
        if (!normalizedClassId) {
            throw new Error('Turma obrigatÃ³ria.');
        }

        const classDoc = await Class.findOne({
            _id: normalizedClassId,
            school_id: schoolId,
        });

        if (!classDoc) {
            throw new Error('Turma nÃ£o encontrada ou nÃ£o pertence Ã  escola.');
        }

        return classDoc;
    }

    _normalizeQuestionPreviewText(question) {
        if (!question) return null;

        if (question.image?.url && !question.text) {
            return 'QuestÃ£o com imagem';
        }

        const rawText = question.text || question.questionText || question.statement || '';
        const normalized = String(rawText)
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!normalized && question.image?.url) {
            return 'ConteÃºdo visual disponÃ­vel';
        }

        if (!normalized) return null;

        return normalized.length > 130 ? `${normalized.slice(0, 127).trim()}...` : normalized;
    }

    _buildExamPreviewPayload(exam) {
        const questions = Array.isArray(exam?.questions) ? exam.questions : [];
        const previewQuestions = questions
            .slice(0, 3)
            .map((question) => this._normalizeQuestionPreviewText(question))
            .filter(Boolean);

        return {
            questionsCount: questions.length,
            previewQuestions,
            hasImages: questions.some((question) => Boolean(question?.image?.url)),
            hasEssayQuestions: questions.some((question) => question?.type === 'DISSERTATIVE'),
            hasObjectiveQuestions: questions.some((question) => question?.type === 'OBJECTIVE'),
            contentPreviewAvailable: previewQuestions.length > 0,
        };
    }

    _serializeExamForList(exam, { includeQuestions = true } = {}) {
        const source = typeof exam?.toObject === 'function' ? exam.toObject() : { ...exam };
        const preview = this._buildExamPreviewPayload(source);

        if (!includeQuestions) {
            delete source.questions;
        }

        return {
            ...source,
            ...preview,
        };
    }

    async getExams(query, schoolId) {
        const filter = { school_id: schoolId };

        if (query?.class_id) {
            const classDoc = await this._ensureClassBelongsToSchool(query.class_id, schoolId);
            filter.class_id = classDoc._id;
        }

        if (query?.subject_id) filter.subject_id = query.subject_id;
        if (query?.teacher_id) filter.teacher_id = query.teacher_id;
        if (query?.status) filter.status = query.status;

        if (query?.search) {
            filter.title = { $regex: String(query.search).trim(), $options: 'i' };
        }

        const includeQuestions = query?.includeQuestions === undefined
            ? true
            : toBooleanQuery(query.includeQuestions);

        const exams = await Exam.find(filter)
            .sort({ applicationDate: -1, createdAt: -1 })
            .populate('class_id subject_id teacher_id reusedFromExamId reusedFromClassId reusedBy settings.evaluationId');

        return exams.map((exam) => this._serializeExamForList(exam, { includeQuestions }));
    }

    async getReusableExams(query, schoolId) {
        const targetClass = await this._ensureClassBelongsToSchool(query?.targetClassId, schoolId);

        const filter = {
            school_id: schoolId,
            class_id: { $ne: targetClass._id },
        };

        if (query?.sourceClassId) {
            const sourceClass = await this._ensureClassBelongsToSchool(query.sourceClassId, schoolId);
            filter.class_id = sourceClass._id;
        }

        if (query?.subject_id || query?.subjectId) {
            filter.subject_id = query.subject_id || query.subjectId;
        }

        if (query?.teacher_id || query?.teacherId) {
            filter.teacher_id = query.teacher_id || query.teacherId;
        }

        if (query?.status) filter.status = query.status;

        if (query?.search) {
            filter.title = { $regex: String(query.search).trim(), $options: 'i' };
        }

        const includeQuestions = query?.includeQuestions === undefined
            ? true
            : toBooleanQuery(query.includeQuestions);

        const exams = await Exam.find(filter)
            .sort({ applicationDate: -1, createdAt: -1 })
            .populate('class_id subject_id teacher_id reusedFromExamId reusedFromClassId reusedBy settings.evaluationId');

        return exams.map((exam) => this._serializeExamForList(exam, { includeQuestions }));
    }

    async getExamById(id, schoolId) {
        return await Exam.findOne({
            _id: id,
            school_id: schoolId,
        }).populate('class_id subject_id teacher_id reusedFromExamId reusedFromClassId reusedBy settings.evaluationId');
    }

    async reuseExamForClass(sourceExamId, targetClassId, schoolId, userId, reuseFromAnotherClass = false) {
        this._logInfo('Reutilizando prova para outra turma.', {
            sourceExamId,
            targetClassId,
            schoolId,
        });

        const [sourceExam, targetClass] = await Promise.all([
            Exam.findOne({ _id: sourceExamId, school_id: schoolId }).lean(),
            this._ensureClassBelongsToSchool(targetClassId, schoolId),
        ]);

        if (!sourceExam) {
            this._logError('Prova de origem nÃ£o encontrada para reutilizaÃ§Ã£o.', {
                sourceExamId,
                schoolId,
            });
            throw new Error('Prova de origem nÃ£o encontrada.');
        }

        const sourceClassId = getObjectIdString(sourceExam.class_id);
        const destinationClassId = getObjectIdString(targetClass._id);

        if (sourceClassId !== destinationClassId && reuseFromAnotherClass !== true) {
            throw new Error('Confirme explicitamente a reutilizaÃ§Ã£o de prova de outra turma.');
        }

        const reusedExam = new Exam({
            school_id: schoolId,
            teacher_id: sourceExam.teacher_id,
            class_id: targetClass._id,
            subject_id: sourceExam.subject_id,
            schoolyear_id: sourceExam.schoolyear_id || null,
            title: sourceExam.title,
            applicationDate: sourceExam.applicationDate || new Date(),
            totalValue: sourceExam.totalValue,
            correctionType: sourceExam.correctionType,
            questions: Array.isArray(sourceExam.questions) ? sourceExam.questions : [],
            status: 'DRAFT',
            settings: {
                evaluationId: null,
                omrLayout: null,
            },
            reusedFromExamId: sourceExam._id,
            reusedFromClassId: sourceExam.class_id,
            reusedAt: new Date(),
            reusedBy: userId || null,
        });

        await this._attachOmrLayoutToExamIfNeeded(reusedExam);
        await reusedExam.save();

        return await this.getExamById(reusedExam._id, schoolId);
    }

    async getExamResults(examId, schoolId, actor) {
        const exam = await this._getReadableExam(examId, schoolId, actor);
        const classId = getObjectIdString(exam.class_id);

        const enrollments = await Enrollment.find({
            class: classId,
            school_id: schoolId,
            status: 'Ativa',
        })
            .populate('student', 'fullName name')
            .select('_id student status')
            .lean();

        const studentIds = enrollments
            .map((enrollment) => getObjectIdString(enrollment.student))
            .filter(Boolean);

        const sheets = studentIds.length > 0
            ? await ExamSheet.find({
                exam_id: exam._id,
                school_id: schoolId,
                student_id: { $in: studentIds },
            }).lean()
            : [];

        const sheetByStudent = new Map(
            sheets.map((sheet) => [getObjectIdString(sheet.student_id), sheet])
        );

        const gradeByStudent = new Map();
        const evaluationId = getObjectIdString(exam.settings?.evaluationId);
        if (evaluationId && studentIds.length > 0) {
            const evaluation = await Evaluation.findOne({
                _id: evaluationId,
                school: schoolId,
                classInfo: classId,
            })
                .select('_id')
                .lean();

            if (evaluation) {
                const grades = await ClassGrade.find({
                    evaluation: evaluation._id,
                    student: { $in: studentIds },
                })
                    .select('_id student enrollment value updatedAt')
                    .lean();

                for (const grade of grades) {
                    gradeByStudent.set(getObjectIdString(grade.student), grade);
                }
            }
        }

        const maxScore = this._finiteNumber(exam.totalValue);
        const totalQuestions = Array.isArray(exam.questions) ? exam.questions.length : 0;

        const students = enrollments
            .map((enrollment) => {
                const studentId = getObjectIdString(enrollment.student);
                const sheet = sheetByStudent.get(studentId) || null;
                const gradeRecord = gradeByStudent.get(studentId) || null;
                const sheetScore = this._finiteNumber(sheet?.grade);
                const gradebookScore = this._finiteNumber(gradeRecord?.value);
                const score = sheetScore ?? gradebookScore;
                const corrected = score !== null;
                const answerSummary = this._buildStoredAnswerSummary(sheet, exam);
                const correctionType = sheet
                    ? (exam.correctionType === 'BUBBLE_SHEET' ? 'omr' : 'manual')
                    : (gradebookScore !== null ? 'manual' : null);
                const correctedAt = sheetScore !== null
                    ? (sheet.updatedAt || sheet.createdAt || null)
                    : (gradeRecord?.updatedAt || null);

                return {
                    studentId,
                    studentName:
                        enrollment.student?.fullName ||
                        enrollment.student?.name ||
                        'Aluno sem nome',
                    enrollmentId: getObjectIdString(enrollment._id),
                    status: corrected ? 'corrected' : 'pending',
                    score,
                    maxScore,
                    percentage:
                        score !== null && maxScore !== null && maxScore > 0
                            ? Math.round((score / maxScore) * 10000) / 100
                            : null,
                    correctAnswers: answerSummary.correctAnswers,
                    wrongAnswers: answerSummary.wrongAnswers,
                    blankAnswers: answerSummary.blankAnswers,
                    totalQuestions,
                    correctionType,
                    correctionSource: sheetScore !== null
                        ? 'exam_sheet'
                        : (gradebookScore !== null ? 'gradebook' : null),
                    correctedAt,
                    sheetId: sheet ? getObjectIdString(sheet._id) : null,
                    sheetStatus: sheet?.status || null,
                    detailsAvailable: answerSummary.detailsAvailable,
                };
            })
            .sort((left, right) => left.studentName.localeCompare(right.studentName, 'pt-BR'));

        const correctedScores = students
            .map((student) => student.score)
            .filter((score) => typeof score === 'number' && Number.isFinite(score));

        return {
            exam: {
                id: getObjectIdString(exam._id),
                title: exam.title,
                subject: exam.subject_id?.name || '',
                classId,
                className: exam.class_id?.name || '',
                applicationDate: exam.applicationDate || null,
                totalQuestions,
                totalPoints: maxScore,
                status: exam.status,
                correctionType: exam.correctionType,
            },
            summary: {
                totalStudents: students.length,
                corrected: correctedScores.length,
                pending: students.length - correctedScores.length,
                averageScore: correctedScores.length > 0
                    ? Math.round(
                        (correctedScores.reduce((sum, score) => sum + score, 0) /
                            correctedScores.length) * 100
                    ) / 100
                    : null,
                highestScore: correctedScores.length > 0 ? Math.max(...correctedScores) : null,
                lowestScore: correctedScores.length > 0 ? Math.min(...correctedScores) : null,
            },
            students,
        };
    }

    async getExamResultDetails(examId, sheetId, schoolId, actor) {
        const exam = await this._getReadableExam(examId, schoolId, actor);
        this._ensureValidObjectId(sheetId, 'ID da folha');

        const sheet = await ExamSheet.findOne({
            _id: sheetId,
            exam_id: exam._id,
            school_id: schoolId,
        })
            .populate('student_id', 'fullName name')
            .lean();

        if (!sheet) {
            throw createHttpError('Correcao nao encontrada.', 404);
        }

        const classId = getObjectIdString(exam.class_id);
        const enrollment = await Enrollment.findOne({
            school_id: schoolId,
            class: classId,
            student: sheet.student_id?._id || sheet.student_id,
            status: 'Ativa',
        })
            .select('_id')
            .lean();

        if (!enrollment) {
            throw createHttpError('Aluno nao encontrado na turma ativa da prova.', 404);
        }

        const isOmr = exam.correctionType === 'BUBBLE_SHEET';
        const storedAnswers = Array.isArray(sheet.answers) ? sheet.answers : [];
        const questions = isOmr
            ? storedAnswers.map((answer) => {
                const number = Number(answer?.questionNumber ?? answer?.question ?? 0);
                const examQuestion = Number.isFinite(number) && number > 0
                    ? exam.questions?.[number - 1] || null
                    : null;
                return this._normalizeStoredAnswer(answer, examQuestion);
            })
            : [];
        const summary = this._buildStoredAnswerSummary(sheet, exam);

        return {
            sheetId: getObjectIdString(sheet._id),
            student: {
                id: getObjectIdString(sheet.student_id),
                name: sheet.student_id?.fullName || sheet.student_id?.name || 'Aluno sem nome',
            },
            exam: {
                id: getObjectIdString(exam._id),
                title: exam.title,
                totalQuestions: Array.isArray(exam.questions) ? exam.questions.length : 0,
            },
            score: this._finiteNumber(sheet.grade),
            objectiveScore: this._finiteNumber(sheet.objectiveGrade),
            dissertativeScore: this._finiteNumber(sheet.dissertativeGrade),
            maxScore: this._finiteNumber(exam.totalValue),
            correctionType: isOmr ? 'omr' : 'manual',
            correctionSource: 'exam_sheet',
            correctedAt: sheet.updatedAt || sheet.createdAt || null,
            sheetStatus: sheet.status || null,
            detailsAvailable: isOmr && questions.length > 0,
            message: isOmr && questions.length > 0
                ? null
                : isOmr
                    ? 'Detalhes por questao indisponiveis para esta correcao OMR.'
                    : 'Correcao manual: detalhes por questao indisponiveis.',
            correctAnswers: summary.correctAnswers,
            wrongAnswers: summary.wrongAnswers,
            blankAnswers: summary.blankAnswers,
            questions,
        };
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
            school_id: schoolId,
            status: 'Ativa',
        }).populate('student');

        let targetStudents = enrollments.map((e) => e.student).filter(Boolean);

        if (Array.isArray(specificStudentIds) && specificStudentIds.length > 0) {
            const allowedIds = new Set(specificStudentIds.map(String));
            targetStudents = targetStudents.filter((student) =>
                allowedIds.has(String(student._id))
            );

            if (targetStudents.length !== allowedIds.size) {
                throw new Error('Um ou mais alunos selecionados nÃ£o pertencem Ã  turma da prova.');
            }
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
