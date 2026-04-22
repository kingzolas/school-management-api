const mongoose = require('mongoose');

const { Schema } = mongoose;

const readReceiptSchema = new Schema(
  {
    viewerType: {
      type: String,
      enum: ['staff', 'guardian', 'student'],
      required: true,
    },
    viewerId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const appNotificationSchema = new Schema(
  {
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    audience: {
      type: String,
      enum: ['staff', 'guardian', 'student'],
      required: true,
      index: true,
    },
    targetRoles: {
      type: [String],
      default: [],
    },
    targetUserIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    targetGuardianIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Tutor' }],
      default: [],
    },
    targetStudentIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
      default: [],
    },
    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    domain: {
      type: String,
      enum: ['documents', 'academic', 'finance', 'activities', 'system'],
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: ['info', 'success', 'warning', 'critical'],
      default: 'info',
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    summary: {
      type: String,
      default: '',
      trim: true,
    },
    routeKey: {
      type: String,
      default: '',
      trim: true,
    },
    entity: {
      type: String,
      default: '',
      trim: true,
    },
    entityId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    threadKey: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    readBy: {
      type: [readReceiptSchema],
      default: [],
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

appNotificationSchema.index({ schoolId: 1, audience: 1, createdAt: -1 });
appNotificationSchema.index({ schoolId: 1, audience: 1, targetRoles: 1, createdAt: -1 });
appNotificationSchema.index({ schoolId: 1, audience: 1, targetGuardianIds: 1, createdAt: -1 });
appNotificationSchema.index(
  { schoolId: 1, type: 1, entityId: 1, audience: 1, createdAt: -1 },
  { background: true, name: 'idx_app_notification_event_entity_audience' }
);

module.exports = mongoose.model('AppNotification', appNotificationSchema);
