const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { getScheduleSlotReadState } = require('../utils/technicalScheduleSlot');

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
    publicationStatus: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft',
        index: true
    },
    publishedAt: {
        type: Date,
        default: null
    },
    publishedByUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    publicationRevertedAt: {
        type: Date,
        default: null
    },
    publicationRevertedByUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    publicationRevertedReason: {
        type: String,
        trim: true,
        default: null
    },
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

scheduleSlotSchema.virtual('teacherId').get(function teacherIdGetter() {
    if (!Array.isArray(this.teacherIds) || this.teacherIds.length === 0) {
        return null;
    }

    const primaryTeacher = this.teacherIds[0];
    return primaryTeacher && primaryTeacher._id ? primaryTeacher._id : primaryTeacher;
});

scheduleSlotSchema.virtual('teacherId').set(function teacherIdSetter(value) {
    if (value === undefined || value === null || value === '') {
        this.teacherIds = [];
        return;
    }

    this.teacherIds = [value];
});

scheduleSlotSchema.virtual('blockingReasons').get(function blockingReasonsGetter() {
    const parentOfferingModule = typeof this.parent === 'function' ? this.parent() : null;
    const parentOffering = parentOfferingModule ? parentOfferingModule.technicalProgramOfferingId : null;
    return getScheduleSlotReadState(this, parentOffering).blockingReasons;
});

scheduleSlotSchema.virtual('isOperational').get(function isOperationalGetter() {
    const parentOfferingModule = typeof this.parent === 'function' ? this.parent() : null;
    const parentOffering = parentOfferingModule ? parentOfferingModule.technicalProgramOfferingId : null;
    return getScheduleSlotReadState(this, parentOffering).isOperational;
});

const ensureScheduleSlotDefaults = (ret) => {
    if (!ret.publicationStatus) {
        ret.publicationStatus = 'draft';
    }

    if (!Object.prototype.hasOwnProperty.call(ret, 'publishedAt')) {
        ret.publishedAt = null;
    }

    if (!Object.prototype.hasOwnProperty.call(ret, 'publishedByUserId')) {
        ret.publishedByUserId = null;
    }

    if (!Object.prototype.hasOwnProperty.call(ret, 'publicationRevertedAt')) {
        ret.publicationRevertedAt = null;
    }

    if (!Object.prototype.hasOwnProperty.call(ret, 'publicationRevertedByUserId')) {
        ret.publicationRevertedByUserId = null;
    }

    if (!Object.prototype.hasOwnProperty.call(ret, 'publicationRevertedReason')) {
        ret.publicationRevertedReason = null;
    }

    if (!Array.isArray(ret.teacherIds)) {
        ret.teacherIds = [];
    }

    return ret;
};

scheduleSlotSchema.set('toJSON', {
    virtuals: true,
    transform: (_, ret) => ensureScheduleSlotDefaults(ret)
});

scheduleSlotSchema.set('toObject', {
    virtuals: true,
    transform: (_, ret) => ensureScheduleSlotDefaults(ret)
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

technicalProgramOfferingModuleSchema.set('toJSON', {
    virtuals: true
});

technicalProgramOfferingModuleSchema.set('toObject', {
    virtuals: true
});

module.exports = mongoose.model('TechnicalProgramOfferingModule', technicalProgramOfferingModuleSchema);
