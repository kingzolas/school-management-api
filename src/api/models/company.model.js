const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const addressSchema = require('./address.model');

const contactPersonSchema = new Schema({
    fullName: {
        type: String,
        required: [true, 'O nome do representante principal é obrigatório.'],
        trim: true
    },
    jobTitle: {
        type: String,
        required: [true, 'O cargo do representante principal é obrigatório.'],
        trim: true
    },
    phone: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true
    }
}, { _id: false });

const companySchema = new Schema({
    name: {
        type: String,
        required: [true, 'O nome da empresa é obrigatório.'],
        trim: true
    },
    legalName: {
        type: String,
        trim: true
    },
    cnpj: {
        type: String,
        required: [true, 'O CNPJ da empresa é obrigatório.'],
        trim: true
    },
    stateRegistration: {
        type: String,
        trim: true
    },
    municipalRegistration: {
        type: String,
        trim: true
    },
    contactPerson: {
        type: contactPersonSchema,
        default: null
    },
    contactPhone: {
        type: String,
        trim: true
    },
    contactEmail: {
        type: String,
        trim: true,
        lowercase: true
    },
    address: {
        type: addressSchema,
        required: true
    },
    logo: {
        data: { type: Buffer, select: false },
        contentType: { type: String }
    },
    logoUrl: {
        type: String
    },
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    },
    status: {
        type: String,
        enum: ['Ativa', 'Inativa'],
        default: 'Ativa',
        index: true
    }
}, {
    timestamps: true
});

companySchema.index({ cnpj: 1, school_id: 1 }, { unique: true });
companySchema.index({ name: 1, school_id: 1 });

companySchema.set('toJSON', {
    transform: function (doc, ret) {
        if (ret.logo) {
            delete ret.logo.data;
        }

        return ret;
    }
});

module.exports = mongoose.model('Company', companySchema);
