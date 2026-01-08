// src/api/models/horario.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const horarioSchema = new Schema({
    // --- Vínculos ---
    termId: { 
        type: Schema.Types.ObjectId, 
        ref: 'Periodo', 
        required: true,
        index: true
    },
    classId: { 
        type: Schema.Types.ObjectId, 
        ref: 'Class', 
        required: true,
        index: true 
    },
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: true,
        index: true
    },
    subjectId: { 
        type: Schema.Types.ObjectId, 
        ref: 'Subject', 
        required: true 
    },
    teacherId: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },
    // --- Tempo ---
    dayOfWeek: { 
        type: Number, 
        required: true, 
        min: 0, 
        max: 7
    },
    startTime: { 
        type: String, 
        required: true, 
        trim: true 
    },
    endTime: { 
        type: String, 
        required: true, 
        trim: true 
    },
    room: { type: String, trim: true }
}, { timestamps: true });

// --- ÍNDICES CORRIGIDOS (ISOLAMENTO POR PERÍODO) ---

// 1. Evita choque na TURMA no mesmo PERÍODO
// Agora inclui 'termId', permitindo o mesmo horário em anos diferentes
horarioSchema.index({ 
    school_id: 1, 
    classId: 1, 
    termId: 1, // <--- O PULO DO GATO
    dayOfWeek: 1, 
    startTime: 1 
}, { unique: true });

// 2. Evita choque do PROFESSOR no mesmo PERÍODO
horarioSchema.index({ 
    school_id: 1, 
    teacherId: 1, 
    termId: 1, // <--- O PULO DO GATO
    dayOfWeek: 1, 
    startTime: 1 
}, { unique: true });

const Horario = mongoose.model('Horario', horarioSchema);

// --- SCRIPT PARA LIMPAR ÍNDICES ANTIGOS E APLICAR OS NOVOS ---
(async () => {
    try {
        // Remove índices antigos que travavam o cadastro entre anos
        await Horario.collection.dropIndexes();
        console.log('🧹 [HorarioModel] Índices antigos removidos.');
        
        // Recria com a nova regra (incluindo termId)
        await Horario.syncIndexes();
        console.log('✅ [HorarioModel] Novos índices sincronizados (Suporte a múltiplos anos ativado).');
    } catch (err) {
        if (err.code !== 26) { // Ignora erro se a coleção for nova
            console.error('⚠️ [HorarioModel] Aviso:', err.message);
        }
    }
})();

module.exports = Horario;