const mongoose = require('mongoose');

const SchoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    legalName: { type: String },
    cnpj: { type: String },
    stateRegistration: { type: String },
    municipalRegistration: { type: String },

    // Novo campo para o Ato Autorizativo/Portaria
    authorizationProtocol: { type: String },

    contactPhone: { type: String },
    contactEmail: { type: String },

    address: {
      street: String,
      number: String,
      neighborhood: String,
      city: String,
      state: String,
      zipCode: String,
    },

    logo: {
      data: { type: Buffer, select: false },
      contentType: { type: String },
    },

    logoUrl: { type: String },

    preferredGateway: {
      type: String,
      enum: ['MERCADOPAGO', 'CORA'],
      default: 'MERCADOPAGO',
    },

    mercadoPagoConfig: {
      prodAccessToken: { type: String, select: false },
      prodPublicKey: { type: String },
      prodClientId: { type: String, select: false },
      prodClientSecret: { type: String, select: false },
      isConfigured: { type: Boolean, default: false },
    },

    coraConfig: {
      isSandbox: { type: Boolean, default: false },
      defaultInterest: {
        percentage: { type: Number, default: 0 },
      },
      defaultFine: {
        percentage: { type: Number, default: 0 },
      },
      defaultDiscount: {
        type: Number,
        default: 0,
      },
      sandbox: {
        clientId: { type: String },
        certificateContent: { type: String, select: false },
        privateKeyContent: { type: String, select: false },
      },
      production: {
        clientId: { type: String },
        certificateContent: { type: String, select: false },
        privateKeyContent: { type: String, select: false },
      },
      isConfigured: { type: Boolean, default: false },
    },

    whatsapp: {
      status: {
        type: String,
        enum: ['disconnected', 'connecting', 'qr_pending', 'connected', 'error'],
        default: 'disconnected',
        index: true,
      },
      instanceName: {
        type: String,
        index: true,
      },
      qrCode: {
        type: String,
        default: null,
        select: false,
      },
      connectedPhone: {
        type: String,
        default: null,
      },
      profileName: {
        type: String,
        default: null,
      },
      lastSyncAt: {
        type: Date,
        default: null,
      },
      lastConnectedAt: {
        type: Date,
        default: null,
      },
      lastDisconnectedAt: {
        type: Date,
        default: null,
      },
      lastError: {
        type: String,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

SchoolSchema.set('toJSON', {
  transform: function (doc, ret) {
    if (ret.mercadoPagoConfig) {
      delete ret.mercadoPagoConfig.prodAccessToken;
      delete ret.mercadoPagoConfig.prodClientSecret;
    }

    if (ret.coraConfig) {
      if (ret.coraConfig.sandbox) {
        delete ret.coraConfig.sandbox.certificateContent;
        delete ret.coraConfig.sandbox.privateKeyContent;
      }

      if (ret.coraConfig.production) {
        delete ret.coraConfig.production.certificateContent;
        delete ret.coraConfig.production.privateKeyContent;
      }
    }

    if (ret.whatsapp) {
      delete ret.whatsapp.qrCode;
    }

    return ret;
  },
});

module.exports = mongoose.model('School', SchoolSchema);