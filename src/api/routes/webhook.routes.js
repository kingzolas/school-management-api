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
// [NOVO] Rota PÚBLICA para o BANCO CORA
// POST /api/webhook/cora
// A Cora envia os dados no Header, o controller fará a leitura correta.
// --------------------------------------------------------------------------
router.post(
  '/cora', 
  (req, res) => webhookController.handleCoraWebhook(req, res)
);

// --------------------------------------------------------------------------
// Rota PÚBLICA para o WHATSAPP (Evolution API)
// POST /api/webhook/whatsapp
// --------------------------------------------------------------------------
router.post('/whatsapp', webhookController.handleWhatsappWebhook.bind(webhookController));

module.exports = router;