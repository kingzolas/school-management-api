const mongoose = require('mongoose');
const { Schema } = mongoose;

const studentOptionSchema = new Schema(
  {
    student_id: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    tutor_id: {
      type: Schema.Types.ObjectId,
      ref: 'Tutor',
      default: null,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    enrollmentNumber: {
      type: String,
      default: null,
      trim: true,
    },
    relationship: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { _id: false }
);

const whatsappSessionSchema = new Schema(
  {
    school_id: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        'active',
        'completed',
        'cancelled',
        'expired',
        'handoff_requested',
        'error',
      ],
      default: 'active',
      index: true,
    },

    session_status: {
      type: String,
      enum: [
        'open',
        'in_progress',
        'waiting_user',
        'completed',
        'expired',
        'cancelled',
        'error',
      ],
      default: 'open',
      index: true,
    },

    resolution_type: {
      type: String,
      enum: [
        'self_service_link',
        'handoff_human',
        'abandoned',
        'invalid_cpf_limit',
        'invalid_selection_limit',
        'technical_error',
        null,
      ],
      default: null,
      index: true,
    },

    current_step: {
      type: String,
      enum: [
        'awaiting_main_option',
        'awaiting_cpf',
        'awaiting_student_selection',
        'generating_link',
        'link_sent',
        'completed',
      ],
      default: 'awaiting_main_option',
      index: true,
    },

    previous_step: {
      type: String,
      enum: [
        'awaiting_main_option',
        'awaiting_cpf',
        'awaiting_student_selection',
        'generating_link',
        'link_sent',
        'completed',
        null,
      ],
      default: null,
    },

    cpf: {
      type: String,
      default: null,
      trim: true,
    },

    attempt_count: {
      type: Number,
      default: 0,
      min: 0,
    },

    invalid_cpf_attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    invalid_selection_attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    selected_student_id: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
    },

    selected_tutor_id: {
      type: Schema.Types.ObjectId,
      ref: 'Tutor',
      default: null,
    },

    student_options: {
      type: [studentOptionSchema],
      default: [],
    },

    message_count_in: {
      type: Number,
      default: 0,
      min: 0,
    },

    message_count_out: {
      type: Number,
      default: 0,
      min: 0,
    },

    handoff_requested_at: {
      type: Date,
      default: null,
    },

    started_at: {
      type: Date,
      default: Date.now,
      index: true,
    },

    finished_at: {
      type: Date,
      default: null,
      index: true,
    },

    closed_at: {
      type: Date,
      default: null,
      index: true,
    },

    last_user_message: {
      type: String,
      default: null,
    },

    last_bot_message: {
      type: String,
      default: null,
    },

    last_interaction_at: {
      type: Date,
      default: Date.now,
      index: true,
    },

    expires_at: {
      type: Date,
      required: true,
      index: true,
    },

    link_sent_at: {
      type: Date,
      default: null,
      index: true,
    },

    link_expires_at: {
      type: Date,
      default: null,
      index: true,
    },

    link_token_id: {
      type: Schema.Types.ObjectId,
      ref: 'TempAccessToken',
      default: null,
      index: true,
    },

    error_code: {
      type: String,
      default: null,
      trim: true,
    },

    error_message: {
      type: String,
      default: null,
      trim: true,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

whatsappSessionSchema.index(
  { school_id: 1, phone: 1, status: 1 },
  { name: 'idx_whatsapp_session_active_lookup' }
);

whatsappSessionSchema.index(
  { school_id: 1, phone: 1, session_status: 1 },
  { name: 'idx_whatsapp_session_status_lookup' }
);

whatsappSessionSchema.index(
  { school_id: 1, started_at: -1 },
  { name: 'idx_whatsapp_session_started_at' }
);

whatsappSessionSchema.index(
  { school_id: 1, finished_at: -1 },
  { name: 'idx_whatsapp_session_finished_at' }
);

module.exports = mongoose.model('WhatsappSession', whatsappSessionSchema);