const mongoose = require('mongoose');
const { Schema } = mongoose;

const tempAccessTokenSchema = new Schema(
  {
    school_id: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    tutor_id: {
      type: Schema.Types.ObjectId,
      ref: 'Tutor',
      default: null,
    },
    student_id: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    requested_phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['student_portal_access'],
      default: 'student_portal_access',
      index: true,
    },
    token_hash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'used', 'expired', 'revoked'],
      default: 'active',
      index: true,
    },
    expires_at: {
      type: Date,
      required: true,
      index: true,
    },
    used_at: {
      type: Date,
      default: null,
    },
    created_by: {
      type: String,
      default: 'whatsapp_bot',
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TempAccessToken', tempAccessTokenSchema);