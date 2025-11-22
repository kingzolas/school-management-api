const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const questionSchema = new Schema({
    category: String,
    question: { type: String, required: true },
    options: [String], 
    correctIndex: { type: Number, required: true }, 
    explanation: {
        correct: String,
        wrongs: [String]
    },
    points: { type: Number, default: 1 }
});

const assessmentSchema = new Schema({
    title: { type: String, required: true },
    description: String,
    
    school_id: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    teacher_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject_id: { type: Schema.Types.ObjectId, ref: 'Subject', required: true }, 

    questions: [questionSchema],
    
    difficultyLevel: { type: String, enum: ['Fácil', 'Médio', 'Difícil'] },
    topic: String, 

    status: { 
        type: String, 
        enum: ['DRAFT', 'PUBLISHED', 'CLOSED'], 
        default: 'DRAFT' 
    },
    settings: {
        timeLimitMinutes: Number, 
        allowRetry: { type: Boolean, default: false },
        showFeedbackInRealTime: { type: Boolean, default: true }
    },
    
    scheduledFor: Date,
    deadline: Date

}, { timestamps: true });

module.exports = mongoose.model('Assessment', assessmentSchema);