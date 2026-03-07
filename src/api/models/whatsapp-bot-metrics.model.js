const mongoose = require('mongoose');

const WhatsappBotMetricsSchema = new mongoose.Schema(
  {
    school_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },

    date: {
      type: Date,
      required: true,
      index: true,
    },

    sessions_started: {
      type: Number,
      default: 0,
    },

    sessions_completed: {
      type: Number,
      default: 0,
    },

    sessions_expired: {
      type: Number,
      default: 0,
    },

    sessions_cancelled: {
      type: Number,
      default: 0,
    },

    handoffs_requested: {
      type: Number,
      default: 0,
    },

    links_generated: {
      type: Number,
      default: 0,
    },

    links_accessed: {
      type: Number,
      default: 0,
    },

    invalid_cpf_count: {
      type: Number,
      default: 0,
    },

    invalid_selection_count: {
      type: Number,
      default: 0,
    },

    total_messages_in: {
      type: Number,
      default: 0,
    },

    total_messages_out: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('WhatsappBotMetrics', WhatsappBotMetricsSchema);