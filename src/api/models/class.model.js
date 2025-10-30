const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const classSchema = new Schema({
    name: { // Ex: "Maternal II A", "4º Ano B"
        type: String,
        required: [true, 'O nome da turma é obrigatório.'],
        trim: true
    },
    schoolYear: { // Ex: 2025, 2026
        type: Number,
        required: [true, 'O ano letivo é obrigatório.'],
        index: true
    },

    // --- [NOVO CAMPO ESTRUTURAL] ---
    level: { // Nível de Ensino
        type: String,
        required: [true, 'O nível de ensino (Infantil, Fundamental I, etc.) é obrigatório.'],
        enum: ['Educação Infantil', 'Ensino Fundamental I', 'Ensino Fundamental II', 'Ensino Médio'],
    },
    // --- FIM DO NOVO CAMPO ---

    grade: { // Série/Nível (Agora é só o nome da série)
        type: String,
        required: [true, 'A série/nível é obrigatória.'] // Ex: "1º Ano", "Maternal II"
    },
    shift: { // Turno
        type: String,
        required: [true, 'O turno é obrigatório.'],
        enum: ['Matutino', 'Vespertino', 'Noturno', 'Integral'],
        default: 'Matutino'
    },
    room: { type: String, trim: true },
    monthlyFee: {
        type: Number,
        required: [true, 'O valor da mensalidade base é obrigatório.'],
        min: [0, 'A mensalidade não pode ser negativa.']
    },
    capacity: { type: Number, min: [1, 'A capacidade deve ser pelo menos 1.'] },
    startTime: { type: String, trim: true },
    endTime: { type: String, trim: true },
    status: {
        type: String,
        enum: ['Planejada', 'Ativa', 'Encerrada', 'Cancelada'],
        default: 'Ativa',
        index: true
    },
}, { timestamps: true });

classSchema.index({ name: 1, schoolYear: 1 }, { unique: true, collation: { locale: 'pt', strength: 2 } });

const Class = mongoose.model('Class', classSchema);
module.exports = Class;