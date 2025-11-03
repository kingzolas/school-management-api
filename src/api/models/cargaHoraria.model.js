const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Define a "Matriz Curricular" ou "Plano de Ensino" em horas.
 * Ex: "Português" na turma "1º Ano B" durante o "1º Bimestre" 
 * deve ter "30" horas de aula no total.
 */
const cargaHorariaSchema = new Schema({
    periodoId: { 
        // Ref: periodo.model.js
        // Indica a qual período (ex: "1º Bimestre 2025") esta carga horária se aplica.
        type: Schema.Types.ObjectId,
        ref: 'Periodo', 
        required: true,
        index: true
    },
    classId: { 
        // Ref: class.model.js
        // A turma específica (ex: "1º Ano B").
        type: Schema.Types.ObjectId,
        ref: 'Class',
        required: true,
        index: true
    },
    subjectId: { 
        // Ref: subject.model.js
        // A matéria (ex: "Português").
        type: Schema.Types.ObjectId,
        ref: 'Subject',
        required: true,
        index: true
    },
    horasNecessarias: { 
        // O total de HORAS (não aulas) que esta matéria deve ter neste período.
        // Usaremos isso para o "Assistente de Balanço".
        type: Number,
        required: true,
        min: 0
    }
}, { timestamps: true });

// Índice único para garantir que não exista mais de uma regra
// para a mesma matéria, na mesma turma, no mesmo período.
cargaHorariaSchema.index({ periodoId: 1, classId: 1, subjectId: 1 }, { unique: true });

const CargaHoraria = mongoose.model('CargaHoraria', cargaHorariaSchema);
module.exports = CargaHoraria;