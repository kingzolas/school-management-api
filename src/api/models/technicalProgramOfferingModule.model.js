const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const scheduleSlotSchema = new Schema({
    weekday: {
        type: Number,
        required: [true, 'O dia da semana do slot e obrigatorio.'],
        min: 1,
        max: 7
    },
    startTime: {
        type: String,
        required: [true, 'O horario inicial do slot e obrigatorio.'],
        trim: true
    },
    endTime: {
        type: String,
        required: [true, 'O horario final do slot e obrigatorio.'],
        trim: true
    },
    teacherIds: [{
        type: Schema.Types.ObjectId,
        ref: 'User'
    }],
    spaceId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalSpace',
        default: null,
        index: true
    },
    durationMinutes: {
        type: Number,
        min: 1,
        default: null
    },
    notes: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['Ativo', 'Inativo'],
        default: 'Ativo'
    }
}, {
    timestamps: false
});

const technicalProgramOfferingModuleSchema = new Schema({
    technicalProgramOfferingId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramOffering',
        required: [true, 'A referencia da oferta tecnica e obrigatoria.'],
        index: true
    },
    technicalProgramModuleId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramModule',
        required: [true, 'A referencia do modulo tecnico e obrigatoria.'],
        index: true
    },
    executionOrder: {
        type: Number,
        required: [true, 'A ordem de execucao na oferta e obrigatoria.'],
        min: 1
    },
    moduleOrderSnapshot: {
        type: Number,
        required: [true, 'A ordem do modulo no momento da oferta e obrigatoria.'],
        min: 1
    },
    plannedWorkloadHours: {
        type: Number,
        required: [true, 'A carga horaria planejada da execucao e obrigatoria.'],
        min: 0
    },
    plannedWeeklyMinutes: {
        type: Number,
        default: 0,
        min: 0
    },
    estimatedWeeks: {
        type: Number,
        default: null,
        min: 0
    },
    estimatedStartDate: {
        type: Date,
        default: null
    },
    estimatedStartDateSource: {
        type: String,
        enum: ['Oferta', 'Manual'],
        default: 'Oferta',
        index: true
    },
    estimatedEndDate: {
        type: Date,
        default: null
    },
    prerequisiteModuleIds: [{
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramModule'
    }],
    scheduleSlots: {
        type: [scheduleSlotSchema],
        default: []
    },
    status: {
        type: String,
        enum: ['Planejado', 'Em andamento', 'Concluído', 'Suspenso', 'Cancelado'],
        default: 'Planejado',
        index: true
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

technicalProgramOfferingModuleSchema.index(
    { technicalProgramOfferingId: 1, technicalProgramModuleId: 1, school_id: 1 },
    { unique: true }
);

technicalProgramOfferingModuleSchema.index(
    { technicalProgramOfferingId: 1, executionOrder: 1, school_id: 1 },
    { unique: true }
);

module.exports = mongoose.model('TechnicalProgramOfferingModule', technicalProgramOfferingModuleSchema);
