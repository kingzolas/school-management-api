const mongoose = require('mongoose');

const { Schema } = mongoose;

const guardianAccessEventSchema = new Schema(
  {
    school_id: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'GuardianAccessAccount',
      default: null,
      index: true,
    },
    linkId: {
      type: Schema.Types.ObjectId,
      ref: 'GuardianAccessLink',
      default: null,
    },
    challengeId: {
      type: Schema.Types.ObjectId,
      ref: 'GuardianFirstAccessChallenge',
      default: null,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
      index: true,
    },
    tutorId: {
      type: Schema.Types.ObjectId,
      ref: 'Tutor',
      default: null,
      index: true,
    },
    actorType: {
      type: String,
      enum: ['public', 'guardian', 'staff', 'system'],
      required: true,
      index: true,
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    eventType: {
      type: String,
      enum: [
        'FIRST_ACCESS_STARTED',
        'FIRST_ACCESS_FAILED',
        'RESPONSIBLE_VERIFIED',
        'RESPONSIBLE_VERIFICATION_FAILED',
        'PIN_SET',
        'PIN_SET_FAILED',
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'ACCOUNT_BLOCKED',
        'ACCOUNT_UNLOCKED',
        'ACCOUNT_DEACTIVATED',
        'ACCOUNT_REACTIVATED',
        'PIN_RESET',
        'STUDENT_LINK_SYNCED',
      ],
      required: true,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

guardianAccessEventSchema.index(
  { school_id: 1, accountId: 1, createdAt: -1 },
  { name: 'idx_guardian_access_event_school_account_created' }
);

guardianAccessEventSchema.index(
  { school_id: 1, studentId: 1, createdAt: -1 },
  { name: 'idx_guardian_access_event_school_student_created' }
);

module.exports = mongoose.model('GuardianAccessEvent', guardianAccessEventSchema);
