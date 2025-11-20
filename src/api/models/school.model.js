const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const addressSchema = require('./address.model'); 

const schoolSchema = new Schema({
    // ... (Mantenha todos os seus campos existentes: name, logo, legalName, etc.) ...
    name: { type: String, required: true, trim: true },
    logo: { data: { type: Buffer, default: null }, contentType: { type: String, default: null } },
    legalName: { type: String, required: true, trim: true },
    cnpj: { type: String, required: true, unique: true, sparse: true, trim: true },
    stateRegistration: { type: String, trim: true, default: null },
    municipalRegistration: { type: String, trim: true, default: null },
    authorizationAct: { type: String, trim: true, default: null },
    
    address: { type: addressSchema },
    contactPhone: { type: String, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },
    
    status: { type: String, enum: ['Ativa', 'Inativa', 'Bloqueada'], default: 'Ativa', required: true },

    // --- [NOVO] Configuração do WhatsApp (Evolution API) ---
    whatsapp: {
        instanceName: { type: String }, // ex: school_64f...
        status: { 
            type: String, 
            enum: ['connected', 'disconnected', 'pairing'], 
            default: 'disconnected' 
        },
        updatedAt: { type: Date }
    }

}, { timestamps: true });

const School = mongoose.model('School', schoolSchema);
module.exports = School;