const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const addressSchema = require('./address.model'); 

// --- CORREÇÃO AQUI ---
// Removi o "select: false" para que o backend consiga ler as chaves
// sem precisar alterar o comando de busca no InvoiceService.
const CoraCredentialsSchema = new Schema({
    clientId: { type: String, trim: true }, // Removido select: false
    certificateContent: { type: String },   // Removido select: false
    privateKeyContent: { type: String }     // Removido select: false
}, { _id: false });

const schoolSchema = new Schema({
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

    whatsapp: {
        instanceName: { type: String },
        status: { 
            type: String, 
            enum: ['connected', 'disconnected', 'pairing'], 
            default: 'disconnected' 
        },
        updatedAt: { type: Date }
    },

    mercadoPagoConfig: {
        prodClientId: { type: String, trim: true, select: false },
        prodClientSecret: { type: String, trim: true, select: false },
        prodPublicKey: { type: String, trim: true },
        prodAccessToken: { type: String, trim: true, select: false },
        isConfigured: { type: Boolean, default: false }
    },

    coraConfig: {
        isSandbox: { type: Boolean, default: true }, 
        
        sandbox: { type: CoraCredentialsSchema, default: {} },
        production: { type: CoraCredentialsSchema, default: {} },
        
        isConfigured: { type: Boolean, default: false }
    },

    preferredGateway: {
        type: String,
        enum: ['MERCADOPAGO', 'CORA'],
        default: 'MERCADOPAGO',
        required: true
    }

}, { timestamps: true });

const School = mongoose.model('School', schoolSchema);
module.exports = School;