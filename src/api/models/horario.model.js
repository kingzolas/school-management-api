// src/api/models/horario.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const horarioSchema = new Schema({

    // --- Vínculos de Tempo/Estrutura ---
    termId: { 
        type: Schema.Types.ObjectId,
        ref: 'Periodo', 
        required: true,
        index: true
    },
    classId: { 
        type: Schema.Types.ObjectId,
        ref: 'Class',
        required: true,
        index: true
    },
    // --- LIGAÇÃO MULTI-TENANCY ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    },
    
    // --- Vínculos de Conteúdo/Pessoa ---
    subjectId: { 
        type: Schema.Types.ObjectId,
        ref: 'Subject',
        required: true
    },
    teacherId: { 
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // --- Definição do Tempo ---
    dayOfWeek: { 
        type: Number,
        required: true,
        min: 0,
        max: 6
    },
    startTime: { 
        type: String,
        required: true,
        trim: true
    },
    endTime: { 
        type: String,
        required: true,
        trim: true
    },
    
    // --- Opcionais ---
    room: { 
        type: String,
        trim: true
    }
}, { timestamps: true });

// Índice para garantir que não haja duas aulas no mesmo horário/dia/turma E ESCOLA.
// O school_id é redundante aqui se classId já o tem, mas é mais seguro:
horarioSchema.index({ classId: 1, dayOfWeek: 1, startTime: 1, school_id: 1 }, { unique: true });
// Índice para buscar rapidamente a grade do professor na escola
horarioSchema.index({ teacherId: 1, dayOfWeek: 1, school_id: 1 });


const Horario = mongoose.model('Horario', horarioSchema);
module.exports = Horario;