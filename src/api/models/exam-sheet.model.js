const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const examSheetSchema = new Schema({
    school_id: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    exam_id: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    
    // Identificador gerado para o QR Code (Ex: "abc123xyz")
    qr_code_uuid: { type: String, required: true, unique: true, index: true },
    
    // Aqui vai entrar o "7.2" lido pela câmera do professor no cabeçalho
    grade: { type: Number, default: null }, 
    
    status: {
        type: String,
        enum: ['PENDING', 'SCANNED', 'VERIFIED'],
        default: 'PENDING'
    },
    
    pdf_generated_at: { type: Date, default: null }
}, { timestamps: true });

examSheetSchema.index({ exam_id: 1, student_id: 1 }, { unique: true });

module.exports = mongoose.model('ExamSheet', examSheetSchema);