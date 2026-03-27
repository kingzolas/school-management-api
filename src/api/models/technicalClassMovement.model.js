const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const technicalClassMovementSchema = new Schema({
    technicalEnrollmentId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalEnrollment',
        required: [true, 'A referência da matrícula técnica é obrigatória.'],
        index: true
    },
    fromClassId: {
        type: Schema.Types.ObjectId,
        ref: 'Class',
        required: [true, 'A turma de origem é obrigatória.'],
        index: true
    },
    toClassId: {
        type: Schema.Types.ObjectId,
        ref: 'Class',
        required: [true, 'A turma de destino é obrigatória.'],
        index: true
    },
    movedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    reason: {
        type: String,
        trim: true
    },
    notes: {
        type: String,
        trim: true
    },
    performedByUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
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

technicalClassMovementSchema.index({ technicalEnrollmentId: 1, movedAt: -1, school_id: 1 });

module.exports = mongoose.model('TechnicalClassMovement', technicalClassMovementSchema);
