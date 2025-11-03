const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const schoolYearSchema = new Schema({
    year: { 
        type: Number, 
        required: true, 
        unique: true // [MODIFICADO] O ano agora é a chave única
    },
    startDate: { 
        type: Date, 
        required: true // Ex: 10/02/2025
    },
    endDate: { 
        type: Date, 
        required: true // Ex: 20/12/2025
    }
    // [REMOVIDO] O campo schoolId foi removido
}, { timestamps: true });

// [REMOVIDO] O índice composto não é mais necessário

const SchoolYear = mongoose.model('SchoolYear', schoolYearSchema);
module.exports = SchoolYear;