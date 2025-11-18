// src/api/models/evento.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const eventoSchema = new Schema({
    title: { 
        type: String,
        required: true,
        trim: true
    },
    eventType: { 
        type: String,
        required: true,
        enum: ['Prova', 'Simulado', 'Trabalho', 'Feriado', 'Evento Escolar', 'Outro'],
        default: 'Outro'
    },
    description: { 
        type: String,
        trim: true
    },
    
    // --- LIGAÇÃO MULTI-TENANCY ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    },
    
    // --- Definição da Data/Hora ---
    date: { 
        type: Date,
        required: true,
        index: true
    },
    startTime: { type: String, trim: true }, 
    endTime: { type: String, trim: true }, 

    // --- Vínculos (Opcionais) ---
    classId: { 
        type: Schema.Types.ObjectId,
        ref: 'Class',
        index: true
    },
    subjectId: { 
        type: Schema.Types.ObjectId,
        ref: 'Subject'
    },
    teacherId: { 
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    
    isSchoolWide: { 
        type: Boolean,
        default: false,
        index: true
    }
}, { timestamps: true });

const Evento = mongoose.model('Evento', eventoSchema);
module.exports = Evento;