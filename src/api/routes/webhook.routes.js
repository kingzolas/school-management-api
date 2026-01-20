const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

// Rota PÚBLICA para a Efí (Desativada/Legado)
// POST /api/webhook/efi
// router.post('/efi', webhookController.handleEfiWebhook); 

// --------------------------------------------------------------------------
// Rota PÚBLICA para o MERCADO PAGO
// POST /api/webhook/mp
// --------------------------------------------------------------------------
router.post(
  '/mp', 
  webhookController.handleMpWebhook
);

// --------------------------------------------------------------------------
// [NOVO] Rota PÚBLICA para o BANCO CORA
// POST /api/webhook/cora
// Configure esta URL no painel de desenvolvedor da Cora
// --------------------------------------------------------------------------
router.post(
  '/cora', 
  (req, res) => webhookController.handleCoraWebhook(req, res)
);

// --------------------------------------------------------------------------
// Rota PÚBLICA para o WHATSAPP (Evolution API)
// POST /api/webhook/whatsapp
// --------------------------------------------------------------------------
router.post('/whatsapp', webhookController.handleWhatsappWebhook);

module.exports = router;