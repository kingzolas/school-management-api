const Exam = require('../models/exam.model');
const ExamSheet = require('../models/exam-sheet.model');
const Student = require('../models/student.model');
const Enrollment = require('../models/enrollment.model');
const Evaluation = require('../models/evaluation.model'); // <-- ADICIONADO
const ClassGrade = require('../models/class.model'); // <-- ADICIONADO
const crypto = require('crypto');

class ExamService {
    async createExam(data, schoolId) {
        console.log("--> [ExamService] Construindo o Model para salvar com os dados:", data);
        
        // 1. Salva a Prova Original (A "matriz" do PDF)
        const exam = new Exam({
            ...data,
            school_id: schoolId
        });
        const savedExam = await exam.save();

        // 2. CRIA A PONTE COM O DIÁRIO: Gera uma coluna de nota no Gradebook automaticamente
        try {
            console.log("--> [ExamService] Criando Evaluation correspondente no Diário...");
            const evaluation = new Evaluation({
                school_id: schoolId,
                class_id: savedExam.class_id,
                subject_id: savedExam.subject_id,
                title: savedExam.title,
                type: 'EXAM', // Marca como prova
                date: savedExam.applicationDate,
                maxScore: savedExam.totalValue,
                // Opcional: Você pode salvar o id da prova original aqui se quiser ligar as duas futuramente
            });
            const savedEval = await evaluation.save();
            
            // Salva o ID da Evaluation na prova, para usarmos na hora de dar a nota!
            savedExam.settings = savedExam.settings || {}; // Garante que o objeto existe
            savedExam.settings.evaluationId = savedEval._id; // <-- Pulo do gato
            await savedExam.save();

            console.log("--> [ExamService] Evaluation criada com sucesso:", savedEval._id);
        } catch (evalErr) {
            console.error("❌ ERRO AO CRIAR EVALUATION:", evalErr.message);
            // Decide se quer dar throw ou apenas seguir
        }

        return savedExam;
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

    /**
     * Gera as Folhas de Prova (ExamSheets).
     */
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

        exam.status = 'READY';
        await exam.save();

        const profName = exam.teacher_id ? (exam.teacher_id.fullName || exam.teacher_id.name || 'Professor') : 'Professor';

        return {
            message: `Gerado com sucesso para ${sheetsCreated.length} alunos.`,
            examDetails: {
                title: exam.title,
                subjectName: exam.subject_id?.name || 'Disciplina',
                teacherName: profName,
                applicationDate: exam.applicationDate
            },
            sheets: sheetsCreated,
            errors
        };
    }

    /**
     * Endpoint chamado pelo celular do Professor ao escanear o QR Code
     */
    async scanExamSheet(qrCodeUuid, grade, schoolId) {
        console.log(`--> [ExamService] Computando nota ${grade} para o QR Code ${qrCodeUuid}`);
        
        const sheet = await ExamSheet.findOne({ qr_code_uuid: qrCodeUuid, school_id: schoolId });
        if (!sheet) throw new Error('QR Code inválido ou folha não encontrada.');

        // 1. Atualiza o status da folha
        sheet.grade = grade;
        sheet.status = 'SCANNED';
        await sheet.save();

        // 2. Busca a Prova para achar a Evaluation correspondente
        const exam = await Exam.findById(sheet.exam_id);
        
        // Verifica se a Prova tem a Evaluation salva
        if (exam && exam.settings && exam.settings.evaluationId) {
            console.log("--> [ExamService] Lançando nota no Diário Oficial...");
            
            // Acha o Enrollment desse aluno nessa turma
            const enrollment = await Enrollment.findOne({
                student: sheet.student_id,
                class: exam.class_id,
                school_id: schoolId
            });

            if (enrollment) {
                // Tenta atualizar ou criar a nota (upsert)
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
                    { upsert: true, new: true } // Se não existir nota, cria uma nova
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