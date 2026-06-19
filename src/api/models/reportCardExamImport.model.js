const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const importItemSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    reportCardId: { type: Schema.Types.ObjectId, ref: 'ReportCard', default: null },
    sheetId: { type: Schema.Types.ObjectId, ref: 'ExamSheet', default: null },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    previousTestScore: { type: Number, default: null },
    newTestScore: { type: Number, default: null },
    previousScore: { type: Number, default: null },
    newScore: { type: Number, default: null },
    status: {
      type: String,
      enum: [
        'updated',
        'noop',
        'ignored',
        'conflict',
        'blocked',
        'failed',
      ],
      required: true,
    },
    action: {
      type: String,
      enum: ['fill', 'overwrite', 'noop', 'ignore', 'block'],
      required: true,
    },
    reason: { type: String, default: null },
    scaleStatus: { type: String, default: null },
    message: { type: String, default: null },
  },
  { _id: false }
);

const reportCardExamImportSchema = new Schema(
  {
    school_id: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    examId: {
      type: Schema.Types.ObjectId,
      ref: 'Exam',
      required: true,
      index: true,
    },
    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
      index: true,
    },
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
      index: true,
    },
    termId: {
      type: Schema.Types.ObjectId,
      ref: 'Periodo',
      required: true,
      index: true,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: { type: String, trim: true, default: '' },
    scoreMode: {
      type: String,
      enum: ['raw', 'normalize_to_component'],
      default: 'raw',
    },
    idempotencyKey: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['processing', 'completed', 'partial', 'noop', 'failed'],
      default: 'processing',
      index: true,
    },
    summary: {
      updatedCount: { type: Number, default: 0 },
      noopCount: { type: Number, default: 0 },
      ignoredCount: { type: Number, default: 0 },
      conflictCount: { type: Number, default: 0 },
      blockedCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 },
      selectedCount: { type: Number, default: 0 },
    },
    items: {
      type: [importItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

reportCardExamImportSchema.index(
  { school_id: 1, idempotencyKey: 1 },
  { unique: true }
);

module.exports = mongoose.model('ReportCardExamImport', reportCardExamImportSchema);
