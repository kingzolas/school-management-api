const mongoose = require('mongoose');

const ReleaseSchema = new mongoose.Schema({
  tag: {
    type: String,
    required: true,
    unique: true, // Garante que não teremos versões duplicadas (ex: v1.0.0)
    index: true
  },
  name: {
    type: String, // O título da release (ex: "Atualização de Segurança")
    required: true
  },
  body: {
    type: String, // O texto em Markdown com as novidades
    default: ''
  },
  publishedAt: {
    type: Date,
    required: true
  },
  htmlUrl: {
    type: String, // Link para visualizar no GitHub (opcional)
  },
  downloadUrl: {
    type: String // Link direto para baixar o .exe (se disponível nos assets)
  }
}, {
  timestamps: true // Cria createdAt e updatedAt automaticamente
});

module.exports = mongoose.model('Release', ReleaseSchema);