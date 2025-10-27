const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const enrollmentSchema = new Schema({
    student: { // Referência ao aluno matriculado
        type: Schema.Types.ObjectId,
        ref: 'Student',
        required: true,
        index: true
    },
    class: { // Referência à turma em que está matriculado
        type: Schema.Types.ObjectId,
        ref: 'Class',
        required: true,
        index: true
    },
    academicYear: { // Ano letivo desta matrícula (redundante com Class, mas útil para queries)
        type: Number,
        required: true,
        index: true
    },
    enrollmentDate: { // Data em que a matrícula foi efetivada
        type: Date,
        default: Date.now
    },
    agreedFee: { // Mensalidade acordada (pode ser diferente da base da turma)
        type: Number,
        required: true // É importante ter esse valor registrado
    },
    status: { // Status atual da matrícula
        type: String,
        required: true,
        enum: ['Ativa', 'Inativa', 'Transferido', 'Concluído', 'Pendente'],
        default: 'Ativa'
    },
    // Opcional: Adicionar campos para controle de pagamento, observações, etc.
    // paymentHistory: [ { month: Number, year: Number, amountPaid: Number, paymentDate: Date, status: String } ]
    // observations: String,
}, { timestamps: true });

// Garante que um aluno só pode estar matriculado uma vez por ano letivo
enrollmentSchema.index({ student: 1, academicYear: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', enrollmentSchema);