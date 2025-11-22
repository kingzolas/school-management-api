const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const answerDetailSchema = new Schema({
    questionIndex: Number,
    selectedOptionIndex: Number,
    isCorrect: Boolean,
    timeSpentMs: Number, 
    switchedAppCount: { type: Number, default: 0 } 
}, { _id: false });

const assessmentAttemptSchema = new Schema({
    school_id: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    student_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    assessment_id: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },

    score: Number, 
    totalQuestions: Number,
    correctCount: Number,
    
    answers: [answerDetailSchema], 

    telemetry: {
        totalTimeMs: Number,     
        browserUserAgent: String, 
        focusLostCount: Number,   
        focusLostTimeMs: Number,  
        startedAt: Date,
        finishedAt: Date
    },

    status: {
        type: String,
        enum: ['IN_PROGRESS', 'COMPLETED', 'ABANDONED'],
        default: 'IN_PROGRESS'
    }

}, { timestamps: true });

assessmentAttemptSchema.index({ student_id: 1, assessment_id: 1 }); 

module.exports = mongoose.model('AssessmentAttempt', assessmentAttemptSchema);