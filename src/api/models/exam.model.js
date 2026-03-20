const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const questionSchema = new Schema({
    type: {
        type: String,
        enum: ['OBJECTIVE', 'DISSERTATIVE'],
        required: true
    },
    text: { type: String, required: true },

    image: {
        url: { type: String, default: null },
        layout: {
            type: String,
            // 👇 AQUI ESTÁ A CORREÇÃO: Atualizado com os novos layouts do Flutter
            enum: ['NONE', 'LEFT_SMALL', 'RIGHT_SMALL', 'CENTER_MEDIUM', 'CENTER_LARGE', 'FULL_WIDTH'],
            default: 'NONE'
        }
    },

    options: [{ type: String }],

    correctAnswer: {
        type: String,
        enum: ['A', 'B', 'C', 'D', 'E', null],
        default: null
    },

    linesToLeave: { type: Number, default: 5 },
    weight: { type: Number, default: 1 }
});

const examSchema = new Schema({
    school_id: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    teacher_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    subject_id: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    schoolyear_id: { type: Schema.Types.ObjectId, ref: 'SchoolYear' },

    title: { type: String, required: true },
    applicationDate: { type: Date, required: true },
    totalValue: { type: Number, required: true },

    correctionType: {
        type: String,
        enum: ['DIRECT_GRADE', 'BUBBLE_SHEET'],
        default: 'DIRECT_GRADE'
    },

    questions: [questionSchema],

    settings: {
        evaluationId: { type: Schema.Types.ObjectId, ref: 'Evaluation', default: null },
        omrLayout: { type: Schema.Types.Mixed, default: null }
    },

    status: {
        type: String,
        enum: ['DRAFT', 'READY', 'PRINTED', 'GRADED'],
        default: 'DRAFT'
    }
}, { timestamps: true });

module.exports = mongoose.model('Exam', examSchema);