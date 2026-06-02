const mongoose = require('mongoose');

const { Schema } = mongoose;

const PAYMENT_METHODS = [
  'pix',
  'bank_transfer',
  'cash',
  'card',
  'card_machine',
  'credit_card',
  'boleto',
  'other',
];

const PAYMENT_STATUSES = ['paid', 'cancelled'];

const schoolSubscriptionPaymentSchema = new Schema(
  {
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'SchoolSubscription',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    paidAt: {
      type: Date,
      required: true,
      index: true,
    },
    method: {
      type: String,
      enum: PAYMENT_METHODS,
      default: 'other',
    },
    referenceMonth: {
      type: String,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: 'paid',
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'PlatformAdmin',
      required: true,
    },
  },
  { timestamps: true }
);

schoolSubscriptionPaymentSchema.index({ schoolId: 1, paidAt: -1 });
schoolSubscriptionPaymentSchema.index({ subscriptionId: 1, paidAt: -1 });

module.exports = mongoose.model('SchoolSubscriptionPayment', schoolSubscriptionPaymentSchema);
