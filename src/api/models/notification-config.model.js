const mongoose = require('mongoose');

const DELIVERY_CHANNELS = ['whatsapp', 'email'];

const WhatsappChannelConfigSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    provider: {
      type: String,
      default: 'evolution',
    },
    sendPdfWhenAvailable: {
      type: Boolean,
      default: true,
    },
    sendTextFallback: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const EmailChannelConfigSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: false,
    },
    provider: {
      type: String,
      default: 'gmail',
    },
    fromAddress: {
      type: String,
      default: 'cobranca@academyhubsistema.com',
    },
    fromName: {
      type: String,
      default: 'Academy Hub | Cobrança',
    },
    replyTo: {
      type: String,
      default: null,
    },
    attachBoletoPdf: {
      type: Boolean,
      default: true,
    },
    includePaymentLink: {
      type: Boolean,
      default: true,
    },
    includePixCode: {
      type: Boolean,
      default: true,
    },
    subjectPrefix: {
      type: String,
      default: null,
    },
    stopOnDailyLimit: {
      type: Boolean,
      default: true,
    },
    paused: {
      type: Boolean,
      default: false,
    },
    pausedAt: {
      type: Date,
      default: null,
    },
    pausedUntil: {
      type: Date,
      default: null,
    },
    pauseReasonCode: {
      type: String,
      default: null,
    },
    pauseReasonMessage: {
      type: String,
      default: null,
    },
    lastProviderErrorAt: {
      type: Date,
      default: null,
    },
    lastProviderErrorCode: {
      type: String,
      default: null,
    },
    mailboxReadEnabled: {
      type: Boolean,
      default: true,
    },
    lastMailboxSyncAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const NotificationChannelsConfigSchema = new mongoose.Schema(
  {
    whatsapp: {
      type: WhatsappChannelConfigSchema,
      default: () => ({}),
    },
    email: {
      type: EmailChannelConfigSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const NotificationConfigSchema = new mongoose.Schema(
  {
    school_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      unique: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: false,
    },

    windowStart: {
      type: String,
      default: '08:00',
    },
    windowEnd: {
      type: String,
      default: '18:00',
    },

    enableReminder: {
      type: Boolean,
      default: true,
    },
    enableNewInvoice: {
      type: Boolean,
      default: true,
    },
    enableDueToday: {
      type: Boolean,
      default: true,
    },
    enableOverdue: {
      type: Boolean,
      default: true,
    },

    primaryChannel: {
      type: String,
      enum: DELIVERY_CHANNELS,
      default: 'whatsapp',
    },
    allowFallback: {
      type: Boolean,
      default: false,
    },
    fallbackChannel: {
      type: String,
      enum: DELIVERY_CHANNELS,
      default: null,
    },
    channels: {
      type: NotificationChannelsConfigSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

NotificationConfigSchema.pre('validate', function normalizeChannels(next) {
  if (!this.channels) {
    this.channels = {};
  }

  if (this.fallbackChannel && this.fallbackChannel === this.primaryChannel) {
    this.fallbackChannel = null;
  }

  next();
});

module.exports = mongoose.model('NotificationConfig', NotificationConfigSchema);
