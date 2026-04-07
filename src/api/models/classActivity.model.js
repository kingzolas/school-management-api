const mongoose = require('mongoose');

const { Schema } = mongoose;

const ACTIVITY_STATUSES = [
  'PLANNED',
  'ACTIVE',
  'IN_REVIEW',
  'COMPLETED',
  'CANCELLED',
];

const ACTIVITY_TYPES = [
  'HOMEWORK',
  'CLASSWORK',
  'PROJECT',
  'READING',
  'PRACTICE',
  'CUSTOM',
];

const SOURCE_TYPES = [
  'BOOK',
  'NOTEBOOK',
  'WORKSHEET',
  'PROJECT',
  'FREE',
  'OTHER',
];

const activitySummarySchema = new Schema(
  {
    totalStudents: { type: Number, default: 0, min: 0 },
    deliveredCount: { type: Number, default: 0, min: 0 },
    partialCount: { type: Number, default: 0, min: 0 },
    notDeliveredCount: { type: Number, default: 0, min: 0 },
    excusedCount: { type: Number, default: 0, min: 0 },
    pendingCount: { type: Number, default: 0, min: 0 },
    correctedCount: { type: Number, default: 0, min: 0 },
    pendingCorrectionCount: { type: Number, default: 0, min: 0 },
    gradedCount: { type: Number, default: 0, min: 0 },
    averageScore: { type: Number, default: null, min: 0 },
  },
  { _id: false }
);

const classActivitySchema = new Schema(
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
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    createdById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      default: null,
      index: true,
    },
    academicYear: {
      type: Number,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    activityType: {
      type: String,
      enum: ACTIVITY_TYPES,
      default: 'HOMEWORK',
      index: true,
    },
    sourceType: {
      type: String,
      enum: SOURCE_TYPES,
      default: 'FREE',
      index: true,
    },
    sourceReference: {
      type: String,
      default: '',
      trim: true,
    },
    isGraded: {
      type: Boolean,
      default: false,
      index: true,
    },
    maxScore: {
      type: Number,
      default: null,
      min: 0,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    dueDate: {
      type: Date,
      required: true,
      index: true,
    },
    correctionDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ACTIVITY_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    visibilityToGuardians: {
      type: Boolean,
      default: false,
    },
    summary: {
      type: activitySummarySchema,
      default: () => ({}),
    },
    lastSubmissionSyncAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

classActivitySchema.index({ schoolId: 1, classId: 1, dueDate: 1 });
classActivitySchema.index({ schoolId: 1, teacherId: 1, status: 1, dueDate: 1 });
classActivitySchema.index({ schoolId: 1, classId: 1, subjectId: 1, dueDate: 1 });

module.exports = mongoose.model('ClassActivity', classActivitySchema);
