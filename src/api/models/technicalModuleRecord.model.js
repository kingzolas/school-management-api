const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const technicalModuleRecordSchema = new Schema({
    technicalEnrollmentId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalEnrollment',
        required: [true, 'A referência da matrícula técnica é obrigatória.'],
        index: true
    },
    technicalProgramModuleId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramModule',
        required: [true, 'A referência do módulo técnico é obrigatória.'],
        index: true
    },
    attemptNumber: {
        type: Number,
        required: [true, 'O número da tentativa é obrigatório.'],
        min: 1
    },
    moduleWorkloadHours: {
        type: Number,
        required: [true, 'A carga horária do módulo é obrigatória.'],
        min: 0
    },
    completedHours: {
        type: Number,
        default: 0,
        min: 0
    },
    status: {
        type: String,
        enum: ['Pendente', 'Em andamento', 'Concluído', 'Reprovado', 'Repetindo'],
        default: 'Pendente',
        index: true
    },
    startedAt: {
        type: Date,
        default: null
    },
    finishedAt: {
        type: Date,
        default: null
    },
    notes: {
        type: String,
        trim: true
    },
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    }
}, {
    timestamps: true
});

technicalModuleRecordSchema.index(
    { technicalEnrollmentId: 1, technicalProgramModuleId: 1, attemptNumber: 1, school_id: 1 },
    { unique: true }
);

module.exports = mongoose.model('TechnicalModuleRecord', technicalModuleRecordSchema);
