const mongoose = require('mongoose');

const SchoolSchema = new mongoose.Schema({
  name: { type: String, required: true },
  legalName: { type: String },
  cnpj: { type: String },
  stateRegistration: { type: String },
  municipalRegistration: { type: String },
  contactPhone: { type: String },
  contactEmail: { type: String },
  
  address: {
    street: String,
    number: String,
    neighborhood: String,
    city: String,
    state: String,
    zipCode: String // Nome padrão usado no banco
  },

  // Campo obrigatório para armazenar os bytes da imagem
  logo: {
    data: { type: Buffer, select: false }, 
    contentType: { type: String }
  },

  logoUrl: { type: String }, 
  
  preferredGateway: { 
    type: String, 
    enum: ['MERCADOPAGO', 'CORA'], 
    default: 'MERCADOPAGO' 
  },

  mercadoPagoConfig: {
    prodAccessToken: { type: String, select: false },
    prodPublicKey: { type: String },
    prodClientId: { type: String, select: false },
    prodClientSecret: { type: String, select: false },
    isConfigured: { type: Boolean, default: false }
  },

  coraConfig: {
    isSandbox: { type: Boolean, default: false },
    defaultInterest: {
        percentage: { type: Number, default: 0 }
    },
    defaultFine: {
        percentage: { type: Number, default: 0 }
    },
    defaultDiscount: { 
        type: Number, default: 0 
    },
    sandbox: {
      clientId: { type: String },
      certificateContent: { type: String, select: false },
      privateKeyContent: { type: String, select: false }
    },
    production: {
      clientId: { type: String },
      certificateContent: { type: String, select: false },
      privateKeyContent: { type: String, select: false }
    },
    isConfigured: { type: Boolean, default: false }
  }

}, {
  timestamps: true
});

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
    return ret;
  }
});

module.exports = mongoose.model('School', SchoolSchema);