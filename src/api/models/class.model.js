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
        index: true // <<< Adicionado índice para performance
    },
    shift: { // Turno
        type: String,
        required: [true, 'O turno é obrigatório.'],
        enum: ['Matutino', 'Vespertino', 'Noturno', 'Integral'],
        default: 'Matutino' // <<< Default adicionado
    },
    grade: { // Série/Nível
        type: String,
        required: [true, 'A série/nível é obrigatória.'] // Ex: "Ensino Fundamental - 4º Ano"
    },
    room: { // Sala (Opcional)
        type: String,
        trim: true
    },
    monthlyFee: { // <<< NOVO: Mensalidade base
        type: Number,
        required: [true, 'O valor da mensalidade base é obrigatório.'],
        min: [0, 'A mensalidade não pode ser negativa.']
    },
    capacity: { // <<< NOVO: Capacidade máxima (Opcional)
        type: Number,
        min: [1, 'A capacidade deve ser pelo menos 1.']
    },
    startTime: { // <<< NOVO: Horário de início (Opcional, formato "HH:MM")
        type: String,
        trim: true
    },
    endTime: { // <<< NOVO: Horário de término (Opcional, formato "HH:MM")
        type: String,
        trim: true
    },
    status: { // <<< NOVO: Status da turma (Opcional)
        type: String,
        enum: ['Planejada', 'Ativa', 'Encerrada', 'Cancelada'],
        default: 'Ativa',
        index: true // <<< Índice útil para filtrar turmas ativas
    },
    // students: [{...}], // <<< REMOVIDO
    // teachers: [{...}], // <<< REMOVIDO (Gerenciar no User/Teacher ou Assignment)

}, { timestamps: true });

// <<< NOVO: Índice único composto para evitar duplicatas >>>
classSchema.index({ name: 1, schoolYear: 1 }, { unique: true, collation: { locale: 'pt', strength: 2 } }); // Collation para case-insensitivity em português

// <<< CORREÇÃO: Exportar o model compilado >>>
const Class = mongoose.model('Class', classSchema);
module.exports = Class;