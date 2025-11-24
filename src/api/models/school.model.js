const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const addressSchema = require('./address.model'); 

const schoolSchema = new Schema({
    // ... (Seus campos existentes) ...
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

    // --- Configuração do WhatsApp (Evolution API) ---
    whatsapp: {
        instanceName: { type: String },
        status: { 
            type: String, 
            enum: ['connected', 'disconnected', 'pairing'], 
            default: 'disconnected' 
        },
        updatedAt: { type: Date }
    },

    // --- [NOVO] Configuração do Mercado Pago (Por Escola) ---
    mercadoPagoConfig: {
        prodClientId: { type: String, trim: true, select: false },
        prodClientSecret: { type: String, trim: true, select: false },
        prodPublicKey: { type: String, trim: true }, // Public Key geralmente não é crítica expor se necessário no front
        prodAccessToken: { type: String, trim: true, select: false }, // CRÍTICO: select false para não vazar
        isConfigured: { type: Boolean, default: false }
    }

}, { timestamps: true });

const School = mongoose.model('School', schoolSchema);
module.exports = School;