const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const periodoSchema = new Schema({
    // Referência ao Ano Letivo
    anoLetivoId: { 
        type: Schema.Types.ObjectId, 
        ref: 'SchoolYear', // Certifique-se que o nome do model do Ano Letivo está certo
        required: true,
        index: true
    },
    // --- [NOVO] LIGAÇÃO MULTI-TENANCY ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    },
    titulo: { 
        type: String, 
        required: true // Ex: "1º Bimestre"
    },
    dataInicio: { 
        type: Date, 
        required: true 
    },
    dataFim: { 
        type: Date, 
        required: true 
    },
    tipo: { 
        type: String,
        required: true,
        enum: ['Letivo', 'NaoLetivo'], 
        default: 'Letivo'
    }
}, { timestamps: true });

// Índice composto: 
// Garante que não existam dois "1º Bimestre" no mesmo Ano Letivo da mesma Escola.
periodoSchema.index({ anoLetivoId: 1, titulo: 1, school_id: 1 }, { unique: true });

const Periodo = mongoose.model('Periodo', periodoSchema);
module.exports = Periodo;