const mongoose = require('mongoose');

const { Schema } = mongoose;

const ACTIVITY_PAGE_STATUSES = ['draft', 'ready', 'published', 'archived'];

const headerOverlaySchema = new Schema(
  {
    xPct: { type: Number, min: 0, max: 100, default: 0 },
    yPct: { type: Number, min: 0, max: 100, default: 0 },
    widthPct: { type: Number, min: 0, max: 100, default: 100 },
    heightPct: { type: Number, min: 0, max: 100, default: 12 },
  },
  { _id: false }
);

const activityPageSchema = new Schema(
  {
    bookId: {
      type: Schema.Types.ObjectId,
      ref: 'ActivityBook',
      required: true,
      index: true,
    },
    pageNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    title: {
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
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    thumbnailKey: {
      type: String,
      trim: true,
      default: '',
    },
    thumbnailUrl: {
      type: String,
      trim: true,
      default: '',
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    headerOverlay: {
      type: headerOverlaySchema,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: ACTIVITY_PAGE_STATUSES,
      default: 'draft',
      index: true,
    },
  },
  { timestamps: true }
);

activityPageSchema.index({ bookId: 1, pageNumber: 1 }, { unique: true });
activityPageSchema.index({ status: 1, enabled: 1, subject: 1, segment: 1, grade: 1 });

module.exports = mongoose.model('ActivityPage', activityPageSchema);
