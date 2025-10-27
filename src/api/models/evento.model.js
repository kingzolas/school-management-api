const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const eventoSchema = new Schema({
    title: { // Ex: "Prova de Matemática", "Simulado Geral", "Feriado: Dia do Professor"
        type: String,
        required: true,
        trim: true
    },
    eventType: { // Para filtrar e colorir no frontend
        type: String,
        required: true,
        enum: ['Prova', 'Simulado', 'Trabalho', 'Feriado', 'Evento Escolar', 'Outro'],
        default: 'Outro'
    },
    description: { // Detalhes (opcional)
        type: String,
        trim: true
    },
    
    // --- Definição da Data/Hora ---
    date: { // O dia EXATO do evento
        type: Date,
        required: true,
        index: true
    },
    startTime: { type: String, trim: true }, // "HH:MM" (Opcional)
    endTime: { type: String, trim: true }, // "HH:MM" (Opcional)

    // --- Vínculos (Opcionais) ---
    classId: { // Para qual turma é este evento? (Nulo se for da escola toda)
        type: Schema.Types.ObjectId,
        ref: 'Class',
        index: true
    },
    subjectId: { // Qual disciplina? (Nulo se não for de uma disciplina específica)
        type: Schema.Types.ObjectId,
        ref: 'Subject'
    },
    teacherId: { // Quem aplicará/criou? (Opcional)
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    
    isSchoolWide: { // 'true' se for um evento para a escola inteira (Feriado, Festa Junina)
        type: Boolean,
        default: false,
        index: true
    }
}, { timestamps: true });

const Evento = mongoose.model('Evento', eventoSchema);
module.exports = Evento;