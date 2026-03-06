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
      enum: ['active', 'completed', 'cancelled', 'expired', 'handoff_requested'],
      default: 'active',
      index: true,
    },
    current_step: {
      type: String,
      enum: [
        'awaiting_main_option',
        'awaiting_cpf',
        'awaiting_student_selection',
        'completed',
      ],
      default: 'awaiting_main_option',
    },
    previous_step: {
      type: String,
      enum: [
        'awaiting_main_option',
        'awaiting_cpf',
        'awaiting_student_selection',
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
    },
    invalid_cpf_attempts: {
      type: Number,
      default: 0,
    },
    invalid_selection_attempts: {
      type: Number,
      default: 0,
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
  },
  { timestamps: true }
);

whatsappSessionSchema.index(
  { school_id: 1, phone: 1, status: 1 },
  { name: 'idx_whatsapp_session_active_lookup' }
);

module.exports = mongoose.model('WhatsappSession', whatsappSessionSchema);