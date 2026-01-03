const mongoose = require('mongoose');

const AnalyticsSchema = new mongoose.Schema({
  event: {
    type: String,
    required: true,
    index: true // Indexado para consultas rápidas de contagem
  },
  path: String,       // Qual página (/home, /contato)
  device: String,     // Mobile ou Desktop
  ip: String,         // Para contar usuários únicos (anonimizado se necessário)
  timestamp: {
    type: Date,
    default: Date.now,
    index: true       // Indexado para filtrar por período (hoje, ontem, mês)
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed, // Flexível para guardar { grade: '1º ano', erro: '...' }
    default: {}
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Analytics', AnalyticsSchema);