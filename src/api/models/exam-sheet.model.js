const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ======================================================================
// [NOVO] Sub-schema para guardar exatamente o que o aluno marcou 
// e se ele acertou ou errou aquela questão específica
// ======================================================================
const studentAnswerSchema = new Schema({
    question_id: { type: Schema.Types.ObjectId, required: true },
    markedOption: { type: String, default: null }, // O que a IA leu: 'A', 'B', etc.
    isCorrect: { type: Boolean, default: false }   // Se bateu com o gabarito
}, { _id: false }); // _id false para não poluir o banco com IDs extras dentro do array

const examSheetSchema = new Schema({
    school_id: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    exam_id: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    
    // Identificador gerado para o QR Code (Ex: "abc123xyz")
    qr_code_uuid: { type: String, required: true, unique: true, index: true },
    
    // ======================================================================
    // [NOVO] Identificador do tipo de prova (Padrão ENEM / Anti-cola)
    // Ex: 'TIPO_1', 'TIPO_2' etc. (Vazio se a prova não for embaralhada)
    // ======================================================================
    examVersion: { type: String, default: 'STANDARD' },
    
    // ======================================================================
    // [ATUALIZADO] Estrutura de notas pronta para Provas Mistas
    // ======================================================================
    grade: { type: Number, default: null },             // Nota Final (Soma de tudo)
    objectiveGrade: { type: Number, default: null },    // Nota dada pela IA (Cartão)
    dissertativeGrade: { type: Number, default: null }, // Nota digitada manualmente pelo Professor
    
    // [NOVO] Array com o raio-x completo da correção feita pela IA
    answers: [studentAnswerSchema],
    
    status: {
        type: String,
        enum: ['PENDING', 'SCANNED', 'VERIFIED'],
        default: 'PENDING'
    },
    
    pdf_generated_at: { type: Date, default: null }
}, { timestamps: true });

examSheetSchema.index({ exam_id: 1, student_id: 1 }, { unique: true });

module.exports = mongoose.model('ExamSheet', examSheetSchema);