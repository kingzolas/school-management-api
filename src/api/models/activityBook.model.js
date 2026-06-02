const mongoose = require('mongoose');

const { Schema } = mongoose;

const ACTIVITY_BOOK_STATUSES = [
  'draft',
  'processing',
  'ready',
  'published',
  'archived',
];

const ACTIVITY_VISIBILITIES = ['global', 'restricted', 'private'];
const ACTIVITY_SOURCE_TYPES = ['global', 'school'];

const activityBookSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    subject: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    segment: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    grade: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    sourceType: {
      type: String,
      enum: ACTIVITY_SOURCE_TYPES,
      default: 'global',
      index: true,
    },
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      default: null,
      index: true,
    },
    originalPdfKey: {
      type: String,
      trim: true,
      default: '',
    },
    originalPdfUrl: {
      type: String,
      trim: true,
      default: '',
    },
    totalPages: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ACTIVITY_BOOK_STATUSES,
      default: 'draft',
      index: true,
    },
    visibility: {
      type: String,
      enum: ACTIVITY_VISIBILITIES,
      default: 'private',
      index: true,
    },
    allowedSchoolIds: [{
      type: Schema.Types.ObjectId,
      ref: 'School',
    }],
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'PlatformAdmin',
      required: true,
    },
    processingError: {
      type: String,
      trim: true,
      default: '',
      select: false,
    },
  },
  { timestamps: true }
);

activityBookSchema.index({ status: 1, visibility: 1, createdAt: -1 });
activityBookSchema.index({ allowedSchoolIds: 1, status: 1, visibility: 1 });

module.exports = mongoose.model('ActivityBook', activityBookSchema);
