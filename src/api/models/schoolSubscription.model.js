const mongoose = require('mongoose');

const { Schema } = mongoose;

const SCHOOL_SUBSCRIPTION_STATUSES = [
  'active',
  'overdue',
  'paid',
  'pending',
  'cancelled',
  'trial',
];

const schoolSubscriptionSchema = new Schema(
  {
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      unique: true,
      index: true,
    },
    planName: {
      type: String,
      trim: true,
      default: 'Sem plano',
    },
    monthlyAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    billingDay: {
      type: Number,
      min: 1,
      max: 31,
      default: 10,
    },
    status: {
      type: String,
      enum: SCHOOL_SUBSCRIPTION_STATUSES,
      default: 'pending',
      index: true,
    },
    lastPaymentDate: {
      type: Date,
      default: null,
    },
    nextDueDate: {
      type: Date,
      default: null,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

schoolSubscriptionSchema.index({ status: 1, nextDueDate: 1 });

module.exports = mongoose.model('SchoolSubscription', schoolSubscriptionSchema);
