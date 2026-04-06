const mongoose = require('mongoose');

const EmailMailboxEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      default: 'gmail',
      index: true,
    },
    gmail_message_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    gmail_thread_id: {
      type: String,
      default: null,
      index: true,
    },
    school_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      default: null,
      index: true,
    },
    notification_log_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NotificationLog',
      default: null,
      index: true,
    },
    notification_transport_log_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NotificationTransportLog',
      default: null,
      index: true,
    },
    internet_message_id: {
      type: String,
      default: null,
      index: true,
    },
    destination_email: {
      type: String,
      default: null,
      index: true,
    },
    classification: {
      type: String,
      default: null,
      index: true,
    },
    detected_at: {
      type: Date,
      default: null,
      index: true,
    },
    processed_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
    subject: {
      type: String,
      default: null,
    },
    snippet: {
      type: String,
      default: null,
    },
    raw_headers: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    raw_payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('EmailMailboxEvent', EmailMailboxEventSchema);
