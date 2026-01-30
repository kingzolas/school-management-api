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
router.post('/trigger', NotificationController.triggerManualRun);

// Configuração
router.get('/config', NotificationController.getConfig);
router.post('/config', NotificationController.saveConfig);

module.exports = router;