const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Sub-schema para intervalos (recreios)
const breakSchema = new Schema({
    description: { type: String, default: 'Intervalo' },
    startTime: { type: String, required: true }, // "HH:MM"
    endTime: { type: String, required: true }    // "HH:MM"
}, { _id: false });

// Sub-schema para regras de dias específicos (exceções)
// (Esta parte já estava correta, só informa o novo N° de aulas)
const dayOverrideSchema = new Schema({
    // 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
    dayOfWeek: { type: Number, required: true, min: 1, max: 6 }, 
    numberOfPeriods: { type: Number, required: true, min: 1 }
}, { _id: false });


const classSchema = new Schema({
    name: { 
        type: String,
        required: [true, 'O nome da turma é obrigatório.'],
        trim: true
    },
    schoolYear: { 
        type: Number,
        required: [true, 'O ano letivo é obrigatório.'],
        index: true
    },
    level: { 
        type: String,
        required: [true, 'O nível de ensino (Infantil, Fundamental I, etc.) é obrigatório.'],
        enum: ['Educação Infantil', 'Ensino Fundamental I', 'Ensino Fundamental II', 'Ensino Médio'],
    },
    grade: { 
        type: String,
        required: [true, 'A série/nível é obrigatória.']
    },
    shift: { 
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
    
    // --- [ESTRUTURA DE REGRAS DE HORÁRIO ATUALIZADA] ---
    scheduleSettings: {
        // Regra Padrão
        defaultStartTime: { type: String, trim: true },       // "HH:MM"
        // defaultEndTime: { type: String, trim: true },      // <-- REMOVIDO
        
        defaultPeriodDuration: { type: Number, min: 1 },    // <-- [NOVO] Duração da aula em minutos (ex: 50)
        
        defaultNumberOfPeriods: { type: Number, min: 1 },     // Ex: 5 (aulas)
        defaultBreaks: [breakSchema],                         // Lista de intervalos
        
        // Regras de Exceção
        dayOverrides: [dayOverrideSchema]
    },

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