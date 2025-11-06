const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

// Rota PÚBLICA para a Efí
// POST /api/webhook/efi
// router.post('/efi', webhookController.handleEfiWebhook); // Desativada

// Rota PÚBLICA para o MERCADO PAGO
// POST /api/webhook/mp
router.post(
  '/mp', 
  webhookController.handleMpWebhook
);

module.exports = router;

