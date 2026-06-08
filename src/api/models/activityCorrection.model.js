const mongoose = require('mongoose');

const { Schema } = mongoose;

const ACTIVITY_CORRECTION_STATUSES = ['pending', 'corrected', 'reviewed', 'voided'];

const criteriaValueSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    value: {
      type: String,
      required: true,
      trim: true,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const criteriaTemplateSnapshotSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    scale: {
      type: [String],
      default: [],
    },
  },
  { _id: false }
);

const activityCorrectionSnapshotSchema = new Schema(
  {
    studentName: { type: String, trim: true, default: '' },
    className: { type: String, trim: true, default: '' },
    teacherName: { type: String, trim: true, default: '' },
    schoolName: { type: String, trim: true, default: '' },
    activityTitle: { type: String, trim: true, default: '' },
    bookTitle: { type: String, trim: true, default: '' },
    subject: { type: String, trim: true, default: '' },
    pageNumber: { type: Number, min: 1, default: 1 },
  },
  { _id: false }
);

const activityCorrectionSchema = new Schema(
  {
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
      index: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    correctedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reviewedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    activityPrintRunId: {
      type: Schema.Types.ObjectId,
      ref: 'ActivityPrintRun',
      required: true,
    },
    qrCodePayload: {
      type: String,
      required: true,
      trim: true,
    },
    activityPrintRunItemId: {
      type: String,
      trim: true,
      default: '',
    },
    activityPageId: {
      type: Schema.Types.ObjectId,
      ref: 'ActivityPage',
      required: true,
      index: true,
    },
    activityBookId: {
      type: Schema.Types.ObjectId,
      ref: 'ActivityBook',
      required: true,
      index: true,
    },
    printDate: {
      type: Date,
      default: null,
    },
    correctionDate: {
      type: Date,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ACTIVITY_CORRECTION_STATUSES,
      default: 'pending',
      index: true,
    },
    criteria: {
      type: [criteriaValueSchema],
      default: [],
    },
    generalObservation: {
      type: String,
      trim: true,
      default: '',
    },
    criteriaTemplateSnapshot: {
      type: [criteriaTemplateSnapshotSchema],
      default: [],
    },
    snapshot: {
      type: activityCorrectionSnapshotSchema,
      default: () => ({}),
    },
    correctedAt: {
      type: Date,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

activityCorrectionSchema.index({ qrCodePayload: 1 }, { unique: true });
activityCorrectionSchema.index({ schoolId: 1, classId: 1, activityPageId: 1, correctionDate: -1 });
activityCorrectionSchema.index({ schoolId: 1, studentId: 1, correctionDate: -1 });
activityCorrectionSchema.index({ schoolId: 1, status: 1, correctionDate: -1 });
activityCorrectionSchema.index({ activityPrintRunId: 1 });

module.exports = mongoose.model('ActivityCorrection', activityCorrectionSchema);
