const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const periodoSchema = new Schema({
    anoLetivoId: { 
        type: Schema.Types.ObjectId, 
        ref: 'AnoLetivo', 
        required: true,
        index: true
    },
    titulo: { 
        type: String, 
        required: true // Ex: "1º Bimestre", "Férias de Julho", "2º Bimestre"
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
        // 'Letivo' = Bimestre, Trimestre, etc. (conta para aulas)
        // 'NaoLetivo' = Férias, Recesso (não conta para aulas)
        enum: ['Letivo', 'NaoLetivo'], 
        default: 'Letivo'
    }
}, { timestamps: true });

const Periodo = mongoose.model('Periodo', periodoSchema);
module.exports = Periodo;