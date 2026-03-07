const mongoose = require('mongoose');

const WhatsappMessageSchema = new mongoose.Schema(
  {
    school_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },

    session_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsappSession',
      required: true,
      index: true,
    },

    phone: {
      type: String,
      required: true,
      index: true,
    },

    direction: {
      type: String,
      enum: ['inbound', 'outbound', 'system'],
      required: true,
    },

    message_text: {
      type: String,
      default: '',
    },

    normalized_text: {
      type: String,
      default: '',
    },

    message_type: {
      type: String,
      enum: ['text', 'menu', 'link', 'error', 'system'],
      default: 'text',
    },

    current_step: {
      type: String,
      default: null,
    },

    detected_intent: {
      type: String,
      default: null,
    },

    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('WhatsappMessage', WhatsappMessageSchema);