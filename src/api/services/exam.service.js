const Exam = require('../models/exam.model');
const ExamSheet = require('../models/exam-sheet.model');
const Student = require('../models/student.model');
const Enrollment = require('../models/enrollment.model');
const Evaluation = require('../models/evaluation.model');
const ClassGrade = require('../models/grade.model');
const crypto = require('crypto');

class ExamService {
    // =========================================================
    // HELPERS OMR
    // =========================================================

    _getObjectiveQuestions(exam) {
        const questions = Array.isArray(exam.questions) ? exam.questions : [];
        return questions.filter(q => q && q.type === 'OBJECTIVE');
    }

    _buildBubbleSheetOmrLayout({ objectiveQuestionsCount }) {
        const totalQuestions = Number(objectiveQuestionsCount || 0);

        if (totalQuestions <= 0) {
            return null;
        }

        // =====================================================
        // ESPELHA A LÓGICA DO PDF NOVO, MAS EM COORDENADAS
        // CANÔNICAS PARA O SCRIPT DE LEITURA
        // =====================================================

        const hasTwoColumns = totalQuestions > 20;
        const questionsPerColumn = hasTwoColumns ? 20 : totalQuestions;
        const columnCount = hasTwoColumns ? 2 : 1;

        // Base canônica usada na leitura
        const canonicalWidth = 1000;
        const canonicalHeight = 1400;

        // Âncoras principais do cartão
        const anchors = {
            topLeft: { x: 60, y: 60 },
            topRight: { x: canonicalWidth - 60, y: 60 },
            bottomRight: { x: canonicalWidth - 60, y: canonicalHeight - 60 },
            bottomLeft: { x: 60, y: canonicalHeight - 60 },
        };

        // Marcadores centrais auxiliares
        const centerRegisters = {
            top: { x: Math.round(canonicalWidth / 2), y: 245 },
            bottom: { x: Math.round(canonicalWidth / 2), y: canonicalHeight - 95 },
        };

        // Região geral do bloco de respostas no novo layout
        const answerRegion = {
            x1: 520,
            y1: 290,
            x2: 875,
            y2: 1115,
        };

        const bubbleRadius = 11;
        const bubbleDiameter = bubbleRadius * 2;

        // Geometria da coluna baseada no cartão novo
        const rowTopStart = 390;
        const rowStep = 56;

        const leftColumn = {
            numberX: 565,
            firstBubbleX: 610,
            bubbleStepX: 56,
            rowStartY: rowTopStart,
            rowStepY: rowStep,
        };

        const rightColumn = {
            numberX: 745,
            firstBubbleX: 790,
            bubbleStepX: 56,
            rowStartY: rowTopStart,
            rowStepY: rowStep,
        };

        const optionLabels = ['A', 'B', 'C', 'D', 'E'];

        const bubbles = [];
        const columnsMeta = [];

        if (!hasTwoColumns) {
            columnsMeta.push({
                columnIndex: 0,
                startQuestion: 1,
                endQuestion: totalQuestions,
                xGuideLeft: 545,
                xGuideRight: 905,
                yTop: rowTopStart - 28,
                yBottom: rowTopStart + ((totalQuestions - 1) * rowStep) + 28,
            });

            for (let q = 1; q <= totalQuestions; q++) {
                const rowIndex = q - 1;
                const cy = leftColumn.rowStartY + (rowIndex * leftColumn.rowStepY);

                for (let optIndex = 0; optIndex < optionLabels.length; optIndex++) {
                    const cx = leftColumn.firstBubbleX + (optIndex * leftColumn.bubbleStepX);

                    bubbles.push({
                        question: q,
                        option: optionLabels[optIndex],
                        columnIndex: 0,
                        rowIndex,
                        x: cx,
                        y: cy,
                        r: bubbleRadius,
                    });
                }
            }
        } else {
            const secondColumnCount = totalQuestions - 20;

            columnsMeta.push({
                columnIndex: 0,
                startQuestion: 1,
                endQuestion: 20,
                xGuideLeft: 545,
                xGuideRight: 725,
                yTop: rowTopStart - 28,
                yBottom: rowTopStart + (19 * rowStep) + 28,
            });

            columnsMeta.push({
                columnIndex: 1,
                startQuestion: 21,
                endQuestion: totalQuestions,
                xGuideLeft: 725,
                xGuideRight: 905,
                yTop: rowTopStart - 28,
                yBottom: rowTopStart + ((secondColumnCount - 1) * rowStep) + 28,
            });

            for (let q = 1; q <= totalQuestions; q++) {
                const isSecondColumn = q > 20;
                const geom = isSecondColumn ? rightColumn : leftColumn;
                const rowIndex = isSecondColumn ? (q - 21) : (q - 1);
                const columnIndex = isSecondColumn ? 1 : 0;
                const cy = geom.rowStartY + (rowIndex * geom.rowStepY);

                for (let optIndex = 0; optIndex < optionLabels.length; optIndex++) {
                    const cx = geom.firstBubbleX + (optIndex * geom.bubbleStepX);

                    bubbles.push({
                        question: q,
                        option: optionLabels[optIndex],
                        columnIndex,
                        rowIndex,
                        x: cx,
                        y: cy,
                        r: bubbleRadius,
                    });
                }
            }
        }

        // Guias laterais por linha (úteis para o script no futuro)
        const rowGuides = [];
        for (let q = 1; q <= totalQuestions; q++) {
            const isSecondColumn = hasTwoColumns && q > 20;
            const geom = isSecondColumn ? rightColumn : leftColumn;
            const rowIndex = isSecondColumn ? (q - 21) : (q - 1);
            const cy = geom.rowStartY + (rowIndex * geom.rowStepY);

            rowGuides.push({
                question: q,
                columnIndex: isSecondColumn ? 1 : 0,
                y: cy,
                leftTick: {
                    x1: geom.numberX - 38,
                    x2: geom.numberX - 20,
                    y: cy,
                },
                rightTick: {
                    x1: geom.firstBubbleX + (4 * geom.bubbleStepX) + 28,
                    x2: geom.firstBubbleX + (4 * geom.bubbleStepX) + 46,
                    y: cy,
                }
            });
        }

        // Marcadores superiores e inferiores das colunas A-E
        const optionGuides = [];
        const guideColumns = hasTwoColumns ? [leftColumn, rightColumn] : [leftColumn];
        guideColumns.forEach((geom, colIdx) => {
            for (let optIndex = 0; optIndex < optionLabels.length; optIndex++) {
                const x = geom.firstBubbleX + (optIndex * geom.bubbleStepX);

                optionGuides.push({
                    columnIndex: colIdx,
                    option: optionLabels[optIndex],
                    topMarker: {
                        x,
                        y: rowTopStart - 52
                    },
                    bottomMarker: {
                        x,
                        y: rowTopStart + ((colIdx === 0 ? Math.min(questionsPerColumn, totalQuestions) : (totalQuestions - 20)) - 1) * rowStep + 52
                    }
                });
            }
        });

        return {
            version: 'OMR_BUBBLE_SHEET_V2',
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
            bubbleDiameter,
            anchors,
            centerRegisters,
            answerRegion,
            columns: columnsMeta,
            rowGuides,
            optionGuides,
            bubbles
        };
    }

    async _attachOmrLayoutToExamIfNeeded(exam) {
        if (!exam) return exam;

        exam.settings = exam.settings || {};

        if (exam.correctionType !== 'BUBBLE_SHEET') {
            if (exam.settings.omrLayout) {
                delete exam.settings.omrLayout;
            }
            return exam;
        }

        const objectiveQuestions = this._getObjectiveQuestions(exam);
        const omrLayout = this._buildBubbleSheetOmrLayout({
            objectiveQuestionsCount: objectiveQuestions.length
        });

        exam.settings.omrLayout = omrLayout;
        return exam;
    }

    async getExamOmrLayout(examId, schoolId) {
        const exam = await Exam.findOne({ _id: examId, school_id: schoolId });
        if (!exam) throw new Error('Prova não encontrada.');

        if (exam.correctionType !== 'BUBBLE_SHEET') {
            throw new Error('Esta prova não utiliza cartão resposta do tipo BUBBLE_SHEET.');
        }

        exam.settings = exam.settings || {};

        if (!exam.settings.omrLayout) {
            await this._attachOmrLayoutToExamIfNeeded(exam);
            await exam.save();
        }

        return exam.settings.omrLayout;
    }

    async verifyExamSheet(qrCodeUuid, schoolId) {
        console.log(`--> [ExamService] Verificando QR Code: ${qrCodeUuid}`);

        const sheet = await ExamSheet.findOne({ qr_code_uuid: qrCodeUuid, school_id: schoolId })
            .populate('student_id', 'fullName name');

        if (!sheet) throw new Error('QR Code inválido ou folha não encontrada.');

        const exam = await Exam.findById(sheet.exam_id)
            .populate('class_id', 'name grade')
            .populate('subject_id', 'name');

        return {
            studentName: sheet.student_id.fullName || sheet.student_id.name,
            examTitle: exam.title,
            subjectName: exam.subject_id.name,
            className: exam.class_id.name || exam.class_id.grade,
            correctionType: exam.correctionType || 'DIRECT_GRADE',
            examVersion: sheet.examVersion || 'STANDARD',
            examId: exam._id,
            hasOmrLayout: !!(exam.settings && exam.settings.omrLayout)
        };
    }

    async createExam(data, schoolId) {
        console.log("--> [ExamService] Construindo o Model para salvar com os dados:", data);

        const exam = new Exam({
            ...data,
            school_id: schoolId,
            correctionType: data.correctionType || 'DIRECT_GRADE'
        });

        await this._attachOmrLayoutToExamIfNeeded(exam);

        const savedExam = await exam.save();

        try {
            console.log("--> [ExamService] Criando Evaluation correspondente no Diário...");
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

            console.log("--> [ExamService] Evaluation criada com sucesso:", savedEval._id);
        } catch (evalErr) {
            console.error("❌ ERRO AO CRIAR EVALUATION:", evalErr.message);
        }

        return savedExam;
    }

    async updateExam(examId, updateData, schoolId) {
        console.log(`--> [ExamService] Tentando atualizar prova ${examId}...`);

        const exam = await Exam.findOne({ _id: examId, school_id: schoolId });
        if (!exam) throw new Error('Prova não encontrada.');

        if (exam.status === 'PRINTED' || exam.status === 'GRADED') {
            throw new Error('Esta prova já foi gerada ou corrigida e não pode mais ser alterada para evitar falhas no gabarito.');
        }

        exam.title = updateData.title || exam.title;
        exam.totalValue = updateData.totalValue || exam.totalValue;
        exam.correctionType = updateData.correctionType || exam.correctionType;
        exam.questions = updateData.questions || exam.questions;
        exam.applicationDate = updateData.applicationDate || exam.applicationDate;

        await this._attachOmrLayoutToExamIfNeeded(exam);

        const updatedExam = await exam.save();

        if (updatedExam.settings && updatedExam.settings.evaluationId) {
            try {
                await Evaluation.findByIdAndUpdate(
                    updatedExam.settings.evaluationId,
                    {
                        title: updatedExam.title,
                        maxScore: updatedExam.totalValue,
                        date: updatedExam.applicationDate
                    }
                );
            } catch (evalErr) {
                console.error("Aviso: Falha ao sincronizar edição com o Diário:", evalErr.message);
            }
        }

        return updatedExam;
    }

    async duplicateExam(examId, schoolId) {
        console.log(`--> [ExamService] Duplicando prova ${examId}...`);

        const originalExam = await Exam.findOne({ _id: examId, school_id: schoolId }).lean();
        if (!originalExam) throw new Error('Prova original não encontrada para duplicar.');

        delete originalExam._id;
        delete originalExam.__v;
        delete originalExam.createdAt;
        delete originalExam.updatedAt;

        if (originalExam.settings) {
            delete originalExam.settings.evaluationId;
        }

        if (originalExam.questions && originalExam.questions.length > 0) {
            originalExam.questions = originalExam.questions.map(q => {
                delete q._id;
                return q;
            });
        }

        originalExam.title = `${originalExam.title} [Cópia]`;
        originalExam.status = 'DRAFT';
        originalExam.applicationDate = new Date();

        return await this.createExam(originalExam, schoolId);
    }

    async getExamSheetsByExamId(examId, schoolId) {
        console.log(`--> [ExamService] Buscando alunos da prova ${examId}...`);

        const exam = await Exam.findOne({ _id: examId, school_id: schoolId });
        if (!exam) throw new Error('Prova não encontrada.');

        const sheets = await ExamSheet.find({ exam_id: examId, school_id: schoolId })
            .populate('student_id', 'name fullName registrationNumber')
            .sort({ 'student_id.name': 1 });

        const formattedSheets = sheets.map(sheet => ({
            id: sheet._id,
            qrCodeUuid: sheet.qr_code_uuid,
            studentId: sheet.student_id._id,
            studentName: sheet.student_id.fullName || sheet.student_id.name,
            registration: sheet.student_id.registrationNumber,
            status: sheet.status,
            grade: sheet.grade,
            objectiveGrade: sheet.objectiveGrade,
            dissertativeGrade: sheet.dissertativeGrade,
            pdfGeneratedAt: sheet.pdf_generated_at
        }));

        return {
            examTitle: exam.title,
            correctionType: exam.correctionType,
            totalSheets: formattedSheets.length,
            scannedCount: formattedSheets.filter(s => s.status === 'SCANNED').length,
            pendingCount: formattedSheets.filter(s => s.status !== 'SCANNED').length,
            hasOmrLayout: !!(exam.settings && exam.settings.omrLayout),
            sheets: formattedSheets
        };
    }

    async getExams(query, schoolId) {
        return await Exam.find({ ...query, school_id: schoolId })
            .populate('class_id', 'name grade')
            .populate('subject_id', 'name')
            .populate('teacher_id', 'name fullName')
            .sort({ applicationDate: -1 });
    }

    async getExamById(id, schoolId) {
        const exam = await Exam.findOne({ _id: id, school_id: schoolId })
            .populate('class_id')
            .populate('subject_id')
            .populate('teacher_id');

        if (!exam) throw new Error('Prova não encontrada.');
        return exam;
    }

    async generateExamSheets(examId, schoolId, specificStudentIds = []) {
        console.log(`--> [ExamService] Gerando folhas para a prova ${examId}...`);

        const exam = await this.getExamById(examId, schoolId);
        let targetStudents = [];

        if (specificStudentIds && specificStudentIds.length > 0) {
            targetStudents = await Student.find({
                _id: { $in: specificStudentIds },
                school_id: schoolId
            });
        } else {
            console.log(`--> [ExamService] Buscando alunos matriculados na turma ${exam.class_id._id}`);
            const enrollments = await Enrollment.find({
                class: exam.class_id._id,
                school_id: schoolId,
                status: 'Ativa'
            }).populate('student');

            targetStudents = enrollments
                .map(enrollment => enrollment.student)
                .filter(student => student != null);
        }

        console.log(`--> [ExamService] Foram encontrados ${targetStudents.length} alunos válidos.`);

        if (targetStudents.length === 0) {
            throw new Error('Nenhum aluno encontrado para gerar as provas.');
        }

        // Garante que a prova tenha o layout OMR salvo uma vez só
        await this._attachOmrLayoutToExamIfNeeded(exam);
        await exam.save();

        const sheetsCreated = [];
        const errors = [];

        for (const student of targetStudents) {
            try {
                let sheet = await ExamSheet.findOne({
                    exam_id: examId,
                    student_id: student._id
                });

                if (sheet) {
                    sheet.pdf_generated_at = new Date();
                    await sheet.save();
                } else {
                    sheet = new ExamSheet({
                        school_id: schoolId,
                        exam_id: examId,
                        student_id: student._id,
                        qr_code_uuid: crypto.randomUUID(),
                        pdf_generated_at: new Date()
                    });
                    await sheet.save();
                }

                sheetsCreated.push({
                    _id: sheet._id,
                    qrCodeUuid: sheet.qr_code_uuid,
                    studentId: student._id,
                    studentName: student.fullName || student.name || 'Aluno Sem Nome',
                    gradeName: exam.class_id.name || exam.class_id.grade || 'Turma não definida',
                });

            } catch (err) {
                console.error(`Erro ao gerar folha para aluno ${student._id}:`, err.message);
                errors.push(`Erro ao gerar folha para aluno ${student._id}: ${err.message}`);
            }
        }

        exam.status = 'PRINTED';
        await exam.save();

        const profName = exam.teacher_id
            ? (exam.teacher_id.fullName || exam.teacher_id.name || 'Professor')
            : 'Professor';

        return {
            message: `Gerado com sucesso para ${sheetsCreated.length} alunos.`,
            examDetails: {
                title: exam.title,
                subjectName: exam.subject_id?.name || 'Disciplina',
                teacherName: profName,
                applicationDate: exam.applicationDate,
                correctionType: exam.correctionType
            },
            omrLayout: exam.settings?.omrLayout || null,
            sheets: sheetsCreated,
            errors
        };
    }

    async scanExamSheet(payload, schoolId) {
        const { qrCodeUuid, grade, objectiveGrade, dissertativeGrade, answers } = payload;

        console.log(`--> [ExamService] Computando resultado para o QR Code ${qrCodeUuid}`);

        const sheet = await ExamSheet.findOne({ qr_code_uuid: qrCodeUuid, school_id: schoolId });
        if (!sheet) throw new Error('QR Code inválido ou folha não encontrada.');

        sheet.grade = grade;

        if (objectiveGrade !== undefined) sheet.objectiveGrade = objectiveGrade;
        if (dissertativeGrade !== undefined) sheet.dissertativeGrade = dissertativeGrade;
        if (answers && Array.isArray(answers)) sheet.answers = answers;

        sheet.status = 'SCANNED';
        await sheet.save();

        const exam = await Exam.findById(sheet.exam_id);

        if (exam && exam.status !== 'GRADED') {
            exam.status = 'GRADED';
            await exam.save();
        }

        if (exam && exam.settings && exam.settings.evaluationId) {
            console.log("--> [ExamService] Lançando nota no Diário Oficial...");

            const enrollment = await Enrollment.findOne({
                student: sheet.student_id,
                class: exam.class_id,
                school_id: schoolId
            });

            if (enrollment) {
                await ClassGrade.findOneAndUpdate(
                    {
                        school_id: schoolId,
                        classId: exam.class_id,
                        evaluationId: exam.settings.evaluationId,
                        studentId: sheet.student_id,
                    },
                    {
                        enrollmentId: enrollment._id,
                        value: grade,
                        dateRecorded: new Date()
                    },
                    { upsert: true, new: true }
                );
                console.log("✅ Nota lançada no Diário com sucesso!");
            } else {
                console.warn("⚠️ Aluno não está mais matriculado nesta turma. A nota não foi para o Diário.");
            }
        } else {
            console.warn("⚠️ A Prova não está vinculada a uma Evaluation do Diário.");
        }

        return sheet;
    }
}

module.exports = new ExamService();