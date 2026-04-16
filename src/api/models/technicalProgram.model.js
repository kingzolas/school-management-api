const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const technicalProgramSchema = new Schema({
    name: {
        type: String,
        required: [true, 'O nome do programa técnico é obrigatório.'],
        trim: true
    },
    code: {
        type: String,
        trim: true,
        default: null
    },
    apprenticeshipProgramName: {
        type: String,
        trim: true,
        default: null
    },
    occupationalArc: {
        type: String,
        trim: true,
        default: null
    },
    cboCodes: {
        type: [String],
        default: []
    },
    description: {
        type: String,
        trim: true
    },
    theoreticalWorkloadHours: {
        type: Number,
        min: 0,
        default: null
    },
    practicalWorkloadHours: {
        type: Number,
        min: 0,
        default: null
    },
    totalWorkloadHours: {
        type: Number,
        required: [true, 'A carga horária total do programa é obrigatória.'],
        min: 0
    },
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    },
    status: {
        type: String,
        enum: ['Ativo', 'Inativo'],
        default: 'Ativo',
        index: true
    }
}, {
    timestamps: true
});

technicalProgramSchema.index({ name: 1, school_id: 1 }, { unique: true });
technicalProgramSchema.index({ code: 1, school_id: 1 });

module.exports = mongoose.model('TechnicalProgram', technicalProgramSchema);
