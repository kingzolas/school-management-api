const mongoose = require('mongoose');

const { Schema } = mongoose;

const ACTIVITY_PAGE_STATUSES = ['draft', 'ready', 'published', 'archived'];
const ACTIVITY_PAGE_TYPES = ['cover', 'index', 'activity', 'support'];
const ACTIVITY_PRINT_LAYOUT_MODES = ['overlay', 'crop-and-recompose'];
const ACTIVITY_PRINT_SCALE_MODES = ['fit-width', 'fit-page'];

const headerOverlaySchema = new Schema(
  {
    xPct: { type: Number, min: 0, max: 100, default: 0 },
    yPct: { type: Number, min: 0, max: 100, default: 0 },
    widthPct: { type: Number, min: 0, max: 100, default: 100 },
    heightPct: { type: Number, min: 0, max: 100, default: 12 },
  },
  { _id: false }
);

const percentRectSchema = new Schema(
  {
    xPct: { type: Number, min: 0, max: 100, required: true },
    yPct: { type: Number, min: 0, max: 100, required: true },
    widthPct: { type: Number, min: 0, max: 100, required: true },
    heightPct: { type: Number, min: 0, max: 100, required: true },
  },
  { _id: false }
);

const printLayoutSchema = new Schema(
  {
    mode: {
      type: String,
      enum: ACTIVITY_PRINT_LAYOUT_MODES,
      default: undefined,
    },
    academyHeaderHeightPct: {
      type: Number,
      min: 0,
      max: 100,
      default: undefined,
    },
    preserveFooter: {
      type: Boolean,
      default: undefined,
    },
    scaleMode: {
      type: String,
      enum: ACTIVITY_PRINT_SCALE_MODES,
      default: undefined,
    },
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
    pageType: {
      type: String,
      enum: ACTIVITY_PAGE_TYPES,
      default: 'activity',
      index: true,
    },
    printable: {
      type: Boolean,
      default: true,
      index: true,
    },
    headerOverlay: {
      type: headerOverlaySchema,
      default: () => ({}),
    },
    contentCrop: {
      type: percentRectSchema,
      default: undefined,
    },
    footerCrop: {
      type: percentRectSchema,
      default: undefined,
    },
    printLayout: {
      type: printLayoutSchema,
      default: undefined,
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
activityPageSchema.index({ bookId: 1, pageType: 1, printable: 1, enabled: 1, status: 1 });

module.exports = mongoose.model('ActivityPage', activityPageSchema);
