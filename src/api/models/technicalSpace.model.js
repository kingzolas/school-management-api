const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const technicalSpaceSchema = new Schema({
    name: {
        type: String,
        required: [true, 'O nome do espaco tecnico e obrigatorio.'],
        trim: true
    },
    type: {
        type: String,
        required: [true, 'O tipo do espaco tecnico e obrigatorio.'],
        enum: ['Sala', 'Laboratorio', 'Oficina', 'Auditorio', 'Outro'],
        index: true
    },
    capacity: {
        type: Number,
        required: [true, 'A capacidade do espaco tecnico e obrigatoria.'],
        min: 1
    },
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referencia da escola (school_id) e obrigatoria.'],
        index: true
    },
    status: {
        type: String,
        enum: ['Ativo', 'Inativo'],
        default: 'Ativo',
        index: true
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

technicalSpaceSchema.index({ name: 1, school_id: 1 }, { unique: true });

module.exports = mongoose.model('TechnicalSpace', technicalSpaceSchema);
