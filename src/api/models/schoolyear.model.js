const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const schoolYearSchema = new Schema({
    year: { 
        type: Number, 
        required: [true, 'O ano é obrigatório.'], 
        // REMOVIDO: unique: true (agora a unicidade é composta, veja abaixo)
    },
    startDate: { 
        type: Date, 
        required: [true, 'A data de início é obrigatória.'] 
    },
    endDate: { 
        type: Date, 
        required: [true, 'A data de término é obrigatória.'] 
    },
    // --- [NOVO] LIGAÇÃO MULTI-TENANCY ---
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola (school_id) é obrigatória.'],
        index: true
    }
}, { timestamps: true });

// --- [NOVO] Índice Composto ---
// Garante que o ano 2025 só exista uma vez NAQUELA ESCOLA.
// Outra escola pode ter o ano 2025 também sem conflito.
schoolYearSchema.index({ year: 1, school_id: 1 }, { unique: true });

const SchoolYear = mongoose.model('SchoolYear', schoolYearSchema);
module.exports = SchoolYear;