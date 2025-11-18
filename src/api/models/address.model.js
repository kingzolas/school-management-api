// src/api/models/address.schema.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Este schema é usado tanto por Aluno quanto por Tutor (e agora por User)
const addressSchema = new Schema({
    street: { 
        type: String, 
        required: [true, 'A rua é obrigatória.'],
        trim: true 
    },
    neighborhood: { 
        type: String, 
        required: [true, 'O bairro é obrigatório.'],
        trim: true 
    },
    number: {
        type: String, 
        default: '',
        trim: true 
    }, 
    block: { // Quadra
        type: String, 
        default: '',
        trim: true 
    }, 
    lot: { // Lote
        type: String, 
        default: '',
        trim: true 
    },
    cep: { // <<< CAMPO NOVO ADICIONADO
        type: String, 
        default: '',
        trim: true
    },
    city: { 
        type: String, 
        required: [true, 'A cidade é obrigatória.'],
        trim: true 
    },
    state: { 
        type: String, 
        required: [true, 'O estado é obrigatório.'],
        trim: true 
    },
}, { _id: false }); // Não armazena ID no subdocumento

module.exports = addressSchema;