const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notification.controller');

// Importação Correta do Middleware (Destructuring)
const { verifyToken } = require('../middlewares/auth.middleware');

// --- DEBUG DE SEGURANÇA (Para garantir que o Controller carregou) ---
if (!NotificationController.getLogs || !NotificationController.saveConfig) {
    console.error("❌ ERRO CRÍTICO: NotificationController não exportou os métodos corretamente.");
}

// Aplica a proteção de login em todas as rotas
router.use(verifyToken);

// --- Definição das Rotas ---

// Monitoramento
router.get('/logs', NotificationController.getLogs);

// Rota de reenvio em massa
router.post('/retry-all', NotificationController.retryAllFailed);
router.post('/clear-queue', NotificationController.clearQueue);

router.post('/trigger', NotificationController.triggerManualRun);

// ✅ NOVA ROTA: Gatilho de liberação em massa do mês
router.post('/trigger-month', NotificationController.triggerMonthInvoices);

router.get('/stats', NotificationController.getDashboardStats);
router.get('/transport-logs', NotificationController.getTransportLogs);
router.get('/forecast', NotificationController.getForecast);

// Configuração
router.get('/config', NotificationController.getConfig);
router.post('/config', NotificationController.saveConfig);
router.post('/enqueue', NotificationController.enqueueInvoice);

module.exports = router;
