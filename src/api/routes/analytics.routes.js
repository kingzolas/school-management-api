const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');

// Rota POST para salvar evento (pública)
// URL: /api/analytics/event
router.post('/event', analyticsController.trackEvent);

// Rota GET para ler o dashboard (pode proteger com middleware se quiser)
// URL: /api/analytics/stats
router.get('/stats', analyticsController.getStats);

module.exports = router;