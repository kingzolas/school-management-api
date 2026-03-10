// src/api/models/tutor.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const addressSchema = require('./address.model');

const tutorFinancialScoreSummarySchema = new Schema({
    totalInvoices: {
        type: Number,
        default: 0,
        min: 0
    },
    paidOnTime: {
        type: Number,
        default: 0,
        min: 0
    },
    paidLate: {
        type: Number,
        default: 0,
        min: 0
    },
    unpaidOverdue: {
        type: Number,
        default: 0,
        min: 0
    },
    consecutiveOnTimePayments: {
        type: Number,
        default: 0,
        min: 0
    },
    consecutiveLatePayments: {
        type: Number,
        default: 0,
        min: 0
    },
    averageDelayDays: {
        type: Number,
        default: 0,
        min: 0
    },
    worstDelayDays: {
        type: Number,
        default: 0,
        min: 0
    },
    totalOverdueAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    lastPaymentAt: {
        type: Date,
        default: null
    },
    lastCalculatedAt: {
        type: Date,
        default: null
    }
}, { _id: false });

const tutorFinancialScoreSchema = new Schema({
    value: {
        type: Number,
        default: 600,
        min: 0,
        max: 1000
    },
    classification: {
        type: String,
        enum: ['excellent', 'good', 'moderate', 'risk', 'high_risk'],
        default: 'moderate'
    },
    status: {
        type: String,
        enum: ['not_calculated', 'calculated', 'insufficient_history'],
        default: 'not_calculated'
    },
    confidenceLevel: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'low'
    },
    summary: {
        type: tutorFinancialScoreSummarySchema,
        default: () => ({})
    }
}, { _id: false });

const tutorSchema = new Schema({
    fullName: {
        type: String,
        required: [true, 'O nome completo do tutor é obrigatório.']
    },

    profession: {
        type: String,
        required: false,
        trim: true
    },

    birthDate: {
        type: Date,
        required: [true, 'A data de nascimento do tutor é obrigatória.']
    },

    gender: {
        type: String,
        enum: ['Masculino', 'Feminino', 'Outro'],
        required: true
    },

    nationality: {
        type: String,
        required: true
    },

    phoneNumber: {
        type: String,
    },

    rg: {
        type: String,
        sparse: true
    },

    cpf: {
        type: String,
        sparse: true,
        required: [false, 'O CPF do tutor é obrigatório.']
    },

    email: {
        type: String,
        lowercase: true,
        sparse: true
    },

    address: {
        type: addressSchema,
        required: true
    },

    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    },

    students: [{
        type: Schema.Types.ObjectId,
        ref: 'Student'
    }],

    financialScore: {
        type: tutorFinancialScoreSchema,
        default: () => ({})
    }
}, {
    timestamps: true
});

tutorSchema.pre('save', function(next) {
    if (this.rg === '') { this.rg = null; }
    if (this.cpf === '') { this.cpf = null; }
    if (this.email === '') { this.email = null; }
    if (this.profession === '') { this.profession = null; }

    if (!this.financialScore) {
        this.financialScore = {};
    }

    next();
});

const Tutor = mongoose.model('Tutor', tutorSchema);

module.exports = Tutor;