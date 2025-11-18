// src/api/models/class.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Sub-schemas (inalterados)
const breakSchema = new Schema({
    description: { type: String, default: 'Intervalo' },
    startTime: { type: String, required: true }, // "HH:MM"
    endTime: { type: String, required: true }    // "HH:MM"
}, { _id: false });

const dayOverrideSchema = new Schema({
    dayOfWeek: { type: Number, required: true, min: 1, max: 6 }, 
    numberOfPeriods: { type: Number, required: true, min: 1 }
}, { _id: false });


const classSchema = new Schema({
    name: { 
        type: String,
        required: [true, 'O nome da turma é obrigatório.'],
        trim: true
    },
    schoolYear: { 
        type: Number,
        required: [true, 'O ano letivo é obrigatório.'],
        index: true
    },
    level: { 
        type: String,
        required: [true, 'O nível de ensino é obrigatório.'],
        enum: ['Educação Infantil', 'Ensino Fundamental I', 'Ensino Fundamental II', 'Ensino Médio'],
    },
    grade: { 
        type: String,
        required: [true, 'A série/nível é obrigatória.']
    },
    shift: { 
        type: String,
        required: [true, 'O turno é obrigatório.'],
        enum: ['Matutino', 'Vespertino', 'Noturno', 'Integral'],
        default: 'Matutino'
    },
    room: { type: String, trim: true },
    monthlyFee: {
        type: Number,
        required: [true, 'O valor da mensalidade base é obrigatório.'],
        min: [0, 'A mensalidade não pode ser negativa.']
    },
    capacity: { type: Number, min: [1, 'A capacidade deve ser pelo menos 1.'] },
    
    scheduleSettings: {
        defaultStartTime: { type: String, trim: true },
        defaultPeriodDuration: { type: Number, min: 1 },
        defaultNumberOfPeriods: { type: Number, min: 1 },
        defaultBreaks: [breakSchema],
        dayOverrides: [dayOverrideSchema]
    },

    // --- [NOVO] LIGAÇÃO MULTI-TENANCY ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School', // Referencia o modelo 'School'
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true // Melhora a performance de buscas por escola
    },
    // ------------------------------------

    status: {
        type: String,
        enum: ['Planejada', 'Ativa', 'Encerrada', 'Cancelada'],
        default: 'Ativa',
        index: true
    },
}, { timestamps: true });

// [MODIFICADO] Índice de unicidade agora inclui a escola
classSchema.index(
    { name: 1, schoolYear: 1, school_id: 1 }, 
    { unique: true, collation: { locale: 'pt', strength: 2 } }
);

const Class = mongoose.model('Class', classSchema);
module.exports = Class;