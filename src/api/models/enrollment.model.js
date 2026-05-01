// src/api/models/enrollment.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const enrollmentOfferSnapshotSchema = new Schema({
    name: String,
    type: String,
    startTime: String,
    endTime: String,
    monthlyFee: Number,
    pricingMode: String,
}, { _id: false });

const permanenceClassSnapshotSchema = new Schema({
    name: String,
    shift: String,
    startTime: String,
    endTime: String,
}, { _id: false });

const enrollmentSchema = new Schema({
    student: { 
        type: Schema.Types.ObjectId,
        ref: 'Student',
        required: true,
        index: true
    },
    class: { 
        type: Schema.Types.ObjectId,
        ref: 'Class',
        required: true,
        index: true
    },
    academicYear: { 
        type: Number,
        required: true,
        index: true
    },
    // --- [NOVO] LIGAÇÃO MULTI-TENANCY ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    },
    
    enrollmentDate: { 
        type: Date,
        default: Date.now
    },
    agreedFee: { 
        type: Number,
        required: true
    },
    enrollmentRegime: {
        type: String,
        enum: [
            'regular',
            'full_time',
            'extended_stay',
            'complementary_activity',
            'reinforcement',
            'other'
        ],
        default: 'regular',
        index: true
    },
    enrollmentOfferId: {
        type: Schema.Types.ObjectId,
        ref: 'EnrollmentOffer',
        default: null,
        index: true
    },
    enrollmentOfferSnapshot: {
        type: enrollmentOfferSnapshotSchema,
        default: undefined
    },
    permanenceClassId: {
        type: Schema.Types.ObjectId,
        ref: 'Class',
        default: null,
        index: true
    },
    permanenceClassSnapshot: {
        type: permanenceClassSnapshotSchema,
        default: undefined
    },
    permanenceNotes: {
        type: String,
        trim: true,
        default: ''
    },
    status: { 
        type: String,
        required: true,
        enum: ['Ativa', 'Inativa', 'Transferido', 'Concluído', 'Pendente'],
        default: 'Ativa'
    },
}, { timestamps: true });

// Garante que um aluno só pode estar matriculado uma vez por ano letivo NESTA ESCOLA
enrollmentSchema.index({ student: 1, academicYear: 1, school_id: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', enrollmentSchema);
