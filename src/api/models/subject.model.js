// src/api/models/subject.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const subjectSchema = new Schema({
    name: { // Ex: "Matemática", "Física", "Português (Gramática)"
        type: String,
        required: [true, 'O nome da disciplina é obrigatório.'],
        unique: true, // Evita duplicatas
        trim: true
    },
    level: { // Nível que esta disciplina se aplica (da sua proposta)
        type: String,
        enum: ['Educação Infantil', 'Ensino Fundamental I', 'Ensino Fundamental II', 'Ensino Médio', 'Geral'],
        default: 'Geral',
        required: true
    }
}, { timestamps: true });

const Subject = mongoose.model('Subject', subjectSchema);
module.exports = Subject;