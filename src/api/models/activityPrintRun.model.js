const mongoose = require('mongoose');

const { Schema } = mongoose;

const ACTIVITY_PRINT_RUN_STATUSES = ['pending', 'generated', 'failed'];
const ACTIVITY_PRINT_ITEM_STATUSES = ['pending', 'generated', 'failed'];

const activityPrintRunItemSchema = new Schema(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    studentName: {
      type: String,
      trim: true,
      default: '',
    },
    qrCodePayload: {
      type: String,
      required: true,
      trim: true,
    },
    pageNumber: {
      type: Number,
      min: 1,
      required: true,
    },
    status: {
      type: String,
      enum: ACTIVITY_PRINT_ITEM_STATUSES,
      default: 'pending',
      index: true,
    },
    errorMessage: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const activityPrintRunSchema = new Schema(
  {
    activityPageId: {
      type: Schema.Types.ObjectId,
      ref: 'ActivityPage',
      required: true,
      index: true,
    },
    bookId: {
      type: Schema.Types.ObjectId,
      ref: 'ActivityBook',
      required: true,
      index: true,
    },
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
      default: null,
      index: true,
    },
    requestedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    printDate: {
      type: Date,
      required: true,
    },
    studentIds: [{
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    }],
    generatedPdfKey: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    status: {
      type: String,
      enum: ACTIVITY_PRINT_RUN_STATUSES,
      default: 'pending',
      index: true,
    },
    errorMessage: {
      type: String,
      trim: true,
      default: '',
    },
    generatedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    snapshot: {
      schoolName: { type: String, trim: true, default: '' },
      schoolLogoContentType: { type: String, trim: true, default: '' },
      className: { type: String, trim: true, default: '' },
      teacherName: { type: String, trim: true, default: '' },
      subject: { type: String, trim: true, default: '' },
      bookTitle: { type: String, trim: true, default: '' },
      activityTitle: { type: String, trim: true, default: '' },
      pageNumber: { type: Number, min: 1, default: 1 },
    },
    items: {
      type: [activityPrintRunItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

activityPrintRunSchema.index({ schoolId: 1, createdAt: -1 });
activityPrintRunSchema.index({ activityPageId: 1, schoolId: 1, createdAt: -1 });
activityPrintRunSchema.index({ 'items.qrCodePayload': 1 });

module.exports = mongoose.model('ActivityPrintRun', activityPrintRunSchema);
