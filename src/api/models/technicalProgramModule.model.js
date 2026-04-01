const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const technicalProgramModuleSchema = new Schema({
    technicalProgramId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgram',
        required: [true, 'A referência do programa técnico é obrigatória.'],
        index: true
    },
    subjectId: {
        type: Schema.Types.ObjectId,
        ref: 'Subject',
        default: null,
        index: true
    },
    name: {
        type: String,
        required: [true, 'O nome do módulo é obrigatório.'],
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    moduleOrder: {
        type: Number,
        required: [true, 'A ordem do módulo é obrigatória.'],
        min: 1
    },
    workloadHours: {
        type: Number,
        required: [true, 'A carga horária do módulo é obrigatória.'],
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

technicalProgramModuleSchema.virtual('canEnterGrade').get(function canEnterGradeGetter() {
    return this.status === 'Ativo' && Boolean(this.subjectId);
});

technicalProgramModuleSchema.index(
    { technicalProgramId: 1, moduleOrder: 1, school_id: 1 },
    { unique: true }
);

technicalProgramModuleSchema.set('toJSON', {
    virtuals: true
});

technicalProgramModuleSchema.set('toObject', {
    virtuals: true
});

module.exports = mongoose.model('TechnicalProgramModule', technicalProgramModuleSchema);
