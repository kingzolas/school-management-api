const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Sub-schema para estruturar cada questão da prova
const questionSchema = new Schema({
    type: { 
        type: String, 
        enum: ['OBJECTIVE', 'DISSERTATIVE'], 
        required: true 
    },
    text: { type: String, required: true }, // O enunciado da questão
    
    // Tratamento de Imagem com as opções de layout
    image: {
        url: { type: String, default: null },
        layout: { 
            type: String, 
            enum: ['NONE', 'SMALL_INLINE', 'MEDIUM_CENTER', 'LARGE_FULL'], 
            default: 'NONE' 
        }
    },
    
    // Exclusivo para questões OBJETIVAS 
    options: [{ type: String }], 
    
    // Exclusivo para questões DISSERTATIVAS
    linesToLeave: { type: Number, default: 5 },
    
    weight: { type: Number, default: 1 } // Quanto vale essa questão na soma total
});

const examSchema = new Schema({
    school_id: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    
    // CORRIGIDO DE tutor_id PARA teacher_id
    teacher_id: { type: Schema.Types.ObjectId, ref: 'User', required: true }, 
    
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    subject_id: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    schoolyear_id: { type: Schema.Types.ObjectId, ref: 'SchoolYear' },
    
    title: { type: String, required: true }, // Ex: "Prova Bimestral de Biologia"
    applicationDate: { type: Date, required: true },
    totalValue: { type: Number, required: true }, // Ex: 10.0
    
    // Array guardando todo o conteúdo da prova
    questions: [questionSchema],

    // ======================================================================
    // [NOVO] Configurações e Ligações Internas (Ponte com o Diário)
    // ======================================================================
    settings: {
        evaluationId: { type: Schema.Types.ObjectId, ref: 'Evaluation' }
    },
    
    status: {
        type: String,
        enum: ['DRAFT', 'READY', 'PRINTED', 'GRADED'],
        default: 'DRAFT'
    }
}, { timestamps: true });

module.exports = mongoose.model('Exam', examSchema);