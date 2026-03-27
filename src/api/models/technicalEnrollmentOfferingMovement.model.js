const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const technicalEnrollmentOfferingMovementSchema = new Schema({
    technicalEnrollmentId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalEnrollment',
        required: [true, 'A referencia da matricula tecnica e obrigatoria.'],
        index: true
    },
    fromTechnicalProgramOfferingId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramOffering',
        default: null,
        index: true
    },
    toTechnicalProgramOfferingId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramOffering',
        required: [true, 'A referencia da oferta de destino e obrigatoria.'],
        index: true
    },
    movementType: {
        type: String,
        enum: ['AtribuicaoInicial', 'Transferencia'],
        required: true,
        default: 'Transferencia',
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
        required: [true, 'A referencia da escola (school_id) e obrigatoria.'],
        index: true
    }
}, {
    timestamps: true
});

technicalEnrollmentOfferingMovementSchema.index(
    { technicalEnrollmentId: 1, movedAt: -1, school_id: 1 }
);

module.exports = mongoose.model('TechnicalEnrollmentOfferingMovement', technicalEnrollmentOfferingMovementSchema);
