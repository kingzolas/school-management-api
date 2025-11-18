// src/api/models/courseLoad.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Garante que o Mongoose registrou os modelos de referência
require('./subject.model.js'); 
require('./periodo.model.js'); 
require('./class.model.js'); 

const courseLoadSchema = new Schema({
    // --- Vínculos de Estrutura ---
    periodoId: { 
        type: Schema.Types.ObjectId, 
        ref: 'Periodo', 
        required: true 
    },
    classId: { 
        type: Schema.Types.ObjectId, 
        ref: 'Class', 
        required: true 
    },
    subjectId: { 
        type: Schema.Types.ObjectId, 
        ref: 'Subject', 
        required: true 
    },
    // --- [NOVO] LIGAÇÃO MULTI-TENANCY ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    },
    
    // --- Dados da Carga ---
    targetHours: { 
        type: Number, 
        required: true,
        min: 0
    }
}, { timestamps: true });

// Garante que uma Turma/Período/Disciplina só tenha uma carga horária NESTA ESCOLA.
courseLoadSchema.index({ periodoId: 1, classId: 1, subjectId: 1, school_id: 1 }, { unique: true });

const CourseLoad = mongoose.model('CourseLoad', courseLoadSchema);
module.exports = CourseLoad;