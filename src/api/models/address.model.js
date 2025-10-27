// src/api/models/address.schema.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Este schema é usado tanto por Aluno quanto por Tutor (e agora por User)
const addressSchema = new Schema({
    street: { 
        type: String, 
        required: [true, 'A rua é obrigatória.'],
        trim: true // <<< Adicionado trim
    },
    neighborhood: { 
        type: String, 
        required: [true, 'O bairro é obrigatório.'],
        trim: true // <<< Adicionado trim
    },
    number: {
        type: String, 
        default: '',
        trim: true // <<< Adicionado trim
    }, 
    block: { // Quadra
        type: String, 
        default: '',
        trim: true // <<< Adicionado trim
    }, 
    lot: { // Lote
        type: String, 
        default: '',
        trim: true // <<< Adicionado trim
    },
    cep: { // <<< CAMPO NOVO ADICIONADO
        type: String, 
        default: '',
        trim: true
    },
    city: { 
        type: String, 
        required: [true, 'A cidade é obrigatória.'],
        trim: true // <<< Adicionado trim
    },
    state: { 
        type: String, 
        required: [true, 'O estado é obrigatório.'],
        trim: true // <<< Adicionado trim
    },
}, { _id: false }); 

module.exports = addressSchema;