// src/api/models/school.model.js
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
    zipCode: String
  },

  logoUrl: { type: String }, 
  
  preferredGateway: { 
    type: String, 
    enum: ['MERCADOPAGO', 'CORA'], 
    default: 'MERCADOPAGO' 
  },

  // Configurações do Mercado Pago
  mercadoPagoConfig: {
    prodAccessToken: { type: String, select: false }, // Protegido
    prodPublicKey: { type: String },
    prodClientId: { type: String, select: false },
    prodClientSecret: { type: String, select: false },
    isConfigured: { type: Boolean, default: false }
  },

  // Configurações do Banco Cora
  coraConfig: {
    isSandbox: { type: Boolean, default: false },
    
    // [NOVO] Configurações Padrão de Cobrança
    defaultInterest: {
        percentage: { type: Number, default: 0 } // Juros Mensal
    },
    defaultFine: {
        percentage: { type: Number, default: 0 } // Multa
    },
    defaultDiscount: { 
        type: Number, default: 0 // Desconto em Reais
    },

    sandbox: {
      clientId: { type: String },
      certificateContent: { type: String, select: false }, // Protegido
      privateKeyContent: { type: String, select: false }   // Protegido
    },
    production: {
      clientId: { type: String },
      certificateContent: { type: String, select: false }, // Protegido
      privateKeyContent: { type: String, select: false }   // Protegido
    },
    isConfigured: { type: Boolean, default: false }
  }

}, {
  timestamps: true
});

// Helper para não enviar segredos no JSON de resposta
SchoolSchema.set('toJSON', {
  transform: function (doc, ret) {
    // Remove campos sensíveis se vierem por engano
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