const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const horarioSchema = new Schema({
    // --- Vínculos Principais ---
    classId: { // A qual turma este horário pertence
        type: Schema.Types.ObjectId,
        ref: 'Class',
        required: true,
        index: true
    },
    subjectId: { // Qual disciplina é lecionada
        type: Schema.Types.ObjectId,
        ref: 'Subject',
        required: true
    },
    teacherId: { // Qual professor (usuário) leciona
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // --- Definição do Tempo ---
    dayOfWeek: { // 1=Segunda, 2=Terça, 3=Quarta, 4=Quinta, 5=Sexta, 6=Sábado, 0=Domingo
        type: Number,
        required: true,
        min: 0,
        max: 6
    },
    startTime: { // Formato "HH:MM" (ex: "07:30")
        type: String,
        required: true,
        trim: true
    },
    endTime: { // Formato "HH:MM" (ex: "08:20")
        type: String,
        required: true,
        trim: true
    },
    
    // --- Opcionais ---
    room: { // Sala (pode sobrescrever a sala padrão da turma, se necessário)
        type: String,
        trim: true
    }
}, { timestamps: true });

// Índice para garantir que não haja duas aulas no mesmo horário/dia/turma
horarioSchema.index({ classId: 1, dayOfWeek: 1, startTime: 1 }, { unique: true });
// Índice para buscar rapidamente a grade do professor
horarioSchema.index({ teacherId: 1, dayOfWeek: 1 });


const Horario = mongoose.model('Horario', horarioSchema);
module.exports = Horario;