const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const studentAnswerSchema = new Schema({
    question_id: { type: Schema.Types.ObjectId, required: false },
    questionNumber: { type: Number, required: true },
    markedOption: {
        type: String,
        enum: ['A', 'B', 'C', 'D', 'E', 'MULTIPLE', 'UNCERTAIN', 'NOT_DETECTED', null],
        default: null
    },
    correctAnswer: {
        type: String,
        enum: ['A', 'B', 'C', 'D', 'E', null],
        default: null
    },
    status: {
        type: String,
        enum: ['ok', 'blank', 'multiple', 'ambiguous', 'uncertain', 'not_detected'],
        default: 'ok'
    },
    omrStatus: { type: String, default: null },
    markedAlternatives: [{ type: String, enum: ['A', 'B', 'C', 'D', 'E'] }],
    earnedPoints: { type: Number, default: 0 },
    maxPoints: { type: Number, default: null },
    confidence: { type: Number, default: null },
    isCorrect: { type: Boolean, default: false }
}, { _id: false });

const examSheetSchema = new Schema({
    school_id: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    exam_id: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true },

    qr_code_uuid: { type: String, required: true, unique: true, index: true },
    examVersion: { type: String, default: 'STANDARD' },

    grade: { type: Number, default: null },
    objectiveGrade: { type: Number, default: null },
    dissertativeGrade: { type: Number, default: null },
    maxGrade: { type: Number, default: null },
    totalQuestions: { type: Number, default: null },
    correctCount: { type: Number, default: null },
    wrongCount: { type: Number, default: null },
    blankCount: { type: Number, default: null },
    multipleCount: { type: Number, default: null },
    uncertainCount: { type: Number, default: null },
    notDetectedCount: { type: Number, default: null },

    answers: [studentAnswerSchema],
    correctionDetails: { type: Schema.Types.Mixed, default: null },

    status: {
        type: String,
        enum: ['PENDING', 'SCANNED', 'VERIFIED'],
        default: 'PENDING'
    },

    pdf_generated_at: { type: Date, default: null }
}, { timestamps: true });

examSheetSchema.index({ exam_id: 1, student_id: 1 }, { unique: true });

module.exports = mongoose.model('ExamSheet', examSheetSchema);
