// src/api/models/school.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const addressSchema = require('./address.model'); // Reutilizando seu schema de endereço

/**
 * Define o "Tenant" (Inquilino) do sistema.
 * Contém dados públicos (Nome, logo) e dados privados/legais
 * (CNPJ, Razão Social) para geração de documentos.
 */
const schoolSchema = new Schema({
    // --- Informações Públicas / de Exibição ---
    name: { // Nome Fantasia
        type: String,
        required: [true, 'O nome (fantasia) da escola é obrigatório.'],
        trim: true,
        unique: true
    },
    
    // --- [MODIFICADO] Armazenamento da Logo no Banco ---
    // Substituído 'logoUrl' por 'logo'
    logo: {
        data: { 
            type: Buffer, // Armazena os dados binários da imagem
            default: null 
        }, 
        contentType: {
            type: String, // Armazena o tipo da imagem (ex: 'image/png', 'image/jpeg')
            default: null
        }
    },

    // --- Informações Legais / Fiscais (Para Documentos) ---
    legalName: { // Razão Social
        type: String,
        required: [true, 'A Razão Social é obrigatória.'],
        trim: true
    },
    cnpj: {
        type: String,
        required: [true, 'O CNPJ é obrigatório.'],
        unique: true,
        sparse: true, 
        trim: true
    },
    stateRegistration: { // Inscrição Estadual
        type: String,
        trim: true,
        default: null
    },
    municipalRegistration: { // Inscrição Municipal
        type: String,
        trim: true,
        default: null
    },
    authorizationAct: { // Ato de Autorização/Reconhecimento (Ex: "Portaria CEE nº 123/2024")
        type: String,
        trim: true,
        default: null
    },
    
    // --- Informações de Endereço e Contato ---
    address: { 
        type: addressSchema 
    },
    contactPhone: {
        type: String,
        trim: true
    },
    contactEmail: {
        type: String,
        trim: true,
        lowercase: true,
        match: [/\S+@\S+\.\S+/, 'Por favor, insira um e-mail de contato válido.']
    },
    
    // --- Controle Interno ---
    status: {
        type: String,
        enum: ['Ativa', 'Inativa', 'Bloqueada'],
        default: 'Ativa',
        required: true
    }
}, {
    timestamps: true
});

// AVISO: Armazenar arquivos grandes (ex: > 16MB) no Mongo
// pode exigir o uso de GridFS. Para logos pequenas, 'Buffer' é suficiente.

const School = mongoose.model('School', schoolSchema);
module.exports = School;