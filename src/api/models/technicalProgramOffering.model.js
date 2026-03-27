const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const technicalProgramOfferingSchema = new Schema({
    technicalProgramId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgram',
        required: [true, 'A referencia do programa tecnico e obrigatoria.'],
        index: true
    },
    name: {
        type: String,
        required: [true, 'O nome da oferta tecnica e obrigatorio.'],
        trim: true
    },
    code: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['Planejada', 'Ativa', 'Concluída', 'Suspensa', 'Cancelada'],
        default: 'Planejada',
        index: true
    },
    plannedStartDate: {
        type: Date,
        required: [true, 'A data prevista de inicio da oferta e obrigatoria.'],
        index: true
    },
    plannedEndDate: {
        type: Date,
        required: [true, 'A data prevista de termino da oferta e obrigatoria.'],
        index: true
    },
    actualStartDate: {
        type: Date,
        default: null
    },
    actualEndDate: {
        type: Date,
        default: null
    },
    shift: {
        type: String,
        enum: ['Manha', 'Tarde', 'Noite', 'Integral'],
        default: null,
        index: true
    },
    capacity: {
        type: Number,
        min: 0,
        default: null
    },
    defaultSpaceId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalSpace',
        default: null,
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

technicalProgramOfferingSchema.virtual('modules', {
    ref: 'TechnicalProgramOfferingModule',
    localField: '_id',
    foreignField: 'technicalProgramOfferingId',
    justOne: false
});

technicalProgramOfferingSchema.index({ school_id: 1, technicalProgramId: 1, plannedStartDate: -1 });
technicalProgramOfferingSchema.index({ school_id: 1, status: 1 });

technicalProgramOfferingSchema.set('toJSON', {
    virtuals: true
});

technicalProgramOfferingSchema.set('toObject', {
    virtuals: true
});

module.exports = mongoose.model('TechnicalProgramOffering', technicalProgramOfferingSchema);
