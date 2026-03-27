const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const technicalModuleRecordSchema = new Schema({
    technicalEnrollmentId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalEnrollment',
        required: [true, 'A referencia da matricula tecnica e obrigatoria.'],
        index: true
    },
    technicalProgramModuleId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramModule',
        required: [true, 'A referencia do modulo tecnico e obrigatoria.'],
        index: true
    },
    technicalProgramOfferingId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramOffering',
        default: null,
        index: true
    },
    technicalProgramOfferingModuleId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramOfferingModule',
        default: null,
        index: true
    },
    attemptNumber: {
        type: Number,
        required: [true, 'O numero da tentativa e obrigatorio.'],
        min: 1
    },
    moduleWorkloadHours: {
        type: Number,
        required: [true, 'A carga horaria do modulo e obrigatoria.'],
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
        required: [true, 'A referencia da escola (school_id) e obrigatoria.'],
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
