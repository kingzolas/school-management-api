const Exam = require('../models/exam.model');
const ExamSheet = require('../models/exam-sheet.model');
const Student = require('../models/student.model');
const Enrollment = require('../models/enrollment.model');
const Evaluation = require('../models/evaluation.model'); 
const ClassGrade = require('../models/grade.model'); 
const crypto = require('crypto');

class ExamService {

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
            examId: exam._id // 👇 ADICIONE ESTA LINHA AQUI!
        };
    }

    async createExam(data, schoolId) {
        console.log("--> [ExamService] Construindo o Model para salvar com os dados:", data);
        
        const exam = new Exam({
            ...data,
            school_id: schoolId,
            correctionType: data.correctionType || 'DIRECT_GRADE' 
        });
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

    // 👇 [NOVO] Trava de segurança e atualização
    async updateExam(examId, updateData, schoolId) {
        console.log(`--> [ExamService] Tentando atualizar prova ${examId}...`);
        
        const exam = await Exam.findOne({ _id: examId, school_id: schoolId });
        if (!exam) throw new Error('Prova não encontrada.');

        // 🔥 A TRAVA DE SEGURANÇA: Se já foi impressa ou corrigida, barra a edição!
        if (exam.status === 'PRINTED' || exam.status === 'GRADED') {
            throw new Error('Esta prova já foi gerada ou corrigida e não pode mais ser alterada para evitar falhas no gabarito.');
        }

        // Atualiza os dados permitidos
        exam.title = updateData.title || exam.title;
        exam.totalValue = updateData.totalValue || exam.totalValue;
        exam.correctionType = updateData.correctionType || exam.correctionType;
        exam.questions = updateData.questions || exam.questions;
        exam.applicationDate = updateData.applicationDate || exam.applicationDate;

        const updatedExam = await exam.save();

        // Tenta atualizar também a Evaluation (Diário) se ela existir
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

    // 👇 [NOVO] Função de Clonagem
    async duplicateExam(examId, schoolId) {
        console.log(`--> [ExamService] Duplicando prova ${examId}...`);
        
        const originalExam = await Exam.findOne({ _id: examId, school_id: schoolId }).lean();
        if (!originalExam) throw new Error('Prova original não encontrada para duplicar.');

        // Remove os IDs do Mongoose para criar um registro virgem
        delete originalExam._id;
        delete originalExam.__v;
        delete originalExam.createdAt;
        delete originalExam.updatedAt;
        if (originalExam.settings) delete originalExam.settings.evaluationId; 
        
        // Remove os _id de dentro das questões também
        if (originalExam.questions && originalExam.questions.length > 0) {
            originalExam.questions = originalExam.questions.map(q => {
                delete q._id;
                return q;
            });
        }

        // Adiciona a tag de Cópia e reseta o status e a data
        originalExam.title = `${originalExam.title} [Cópia]`;
        originalExam.status = 'DRAFT';
        originalExam.applicationDate = new Date();

        // Envia para o create normal, que vai salvar no banco E criar uma nova Evaluation no diário!
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

        // 🔥 ATUALIZA O STATUS PARA BLOQUEAR FUTURAS EDIÇÕES
        exam.status = 'PRINTED'; 
        await exam.save();

        const profName = exam.teacher_id ? (exam.teacher_id.fullName || exam.teacher_id.name || 'Professor') : 'Professor';

        return {
            message: `Gerado com sucesso para ${sheetsCreated.length} alunos.`,
            examDetails: {
                title: exam.title,
                subjectName: exam.subject_id?.name || 'Disciplina',
                teacherName: profName,
                applicationDate: exam.applicationDate,
                correctionType: exam.correctionType 
            },
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
        
        // 🔥 ATUALIZA O STATUS DA PROVA PARA INDICAR QUE ELA ESTÁ SENDO CORRIGIDA
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