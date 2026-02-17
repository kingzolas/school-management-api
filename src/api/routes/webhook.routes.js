// src/api/routes/webhook.routes.js
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

// --------------------------------------------------------------------------
// Rota PÚBLICA para o MERCADO PAGO
// POST /api/webhook/mp
// --------------------------------------------------------------------------
router.post(
  '/mp',
  webhookController.handleMpWebhook.bind(webhookController)
);

// --------------------------------------------------------------------------
// Rota PÚBLICA para o BANCO CORA
// POST /api/webhook/cora
// --------------------------------------------------------------------------
router.post(
  '/cora',
  webhookController.handleCoraWebhook.bind(webhookController)
);

// --------------------------------------------------------------------------
// Rota PÚBLICA para o WHATSAPP (Evolution API)
// POST /api/webhook/whatsapp
// --------------------------------------------------------------------------
router.post(
  '/whatsapp',
  webhookController.handleWhatsappWebhook.bind(webhookController)
);

module.exports = router;
