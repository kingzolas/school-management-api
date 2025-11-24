const express = require('express');
const router = express.Router();
const DashboardController = require('../controllers/dashboard.controller');

// CORREÇÃO AQUI: Usamos chaves { } para extrair a função verifyToken do objeto exportado
const { verifyToken } = require('../middlewares/auth.middleware'); 

// Rota: GET /api/dashboard
// Agora passamos a função 'verifyToken' e não o objeto inteiro
router.get('/', verifyToken, DashboardController.getMetrics);

module.exports = router;