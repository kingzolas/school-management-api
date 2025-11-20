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


// [NOVO] Rota PÚBLICA para o WHATSAPP (Evolution API)
// Essa é a rota que a Evolution está tentando chamar e dando 404
router.post('/whatsapp', webhookController.handleWhatsappWebhook);
module.exports = router;

