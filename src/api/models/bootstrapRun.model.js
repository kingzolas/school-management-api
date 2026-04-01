const mongoose = require('mongoose');

const bootstrapRunSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['running', 'completed', 'failed'],
        required: true,
        index: true
    },
    startedAt: {
        type: Date,
        default: null
    },
    completedAt: {
        type: Date,
        default: null
    },
    failedAt: {
        type: Date,
        default: null
    },
    schoolName: {
        type: String,
        trim: true,
        default: null
    },
    schoolId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'School',
        default: null
    },
    adminUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    createdIds: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({})
    },
    resultSummary: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({})
    },
    lastError: {
        type: String,
        default: null
    }
}, {
    collection: 'bootstrap_runs',
    timestamps: true
});

module.exports = mongoose.model('BootstrapRun', bootstrapRunSchema);
