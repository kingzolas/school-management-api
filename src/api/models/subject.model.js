// src/api/models/subject.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const subjectSchema = new Schema({
    name: { 
        type: String,
        required: [true, 'O nome da disciplina é obrigatório.'],
        trim: true
        // REMOVIDO: unique: true (agora a unicidade é composta, veja abaixo)
    },
    level: { 
        type: String,
        enum: ['Educação Infantil', 'Ensino Fundamental I', 'Ensino Fundamental II', 'Ensino Médio', 'Geral'],
        default: 'Geral',
        required: true
    },
    // --- [NOVO] LIGAÇÃO MULTI-TENANCY ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    }
}, { timestamps: true });

// --- [NOVO] Índice Composto ---
// Garante que o nome seja único APENAS dentro da mesma escola.
subjectSchema.index({ name: 1, school_id: 1 }, { unique: true });

const Subject = mongoose.model('Subject', subjectSchema);
module.exports = Subject;