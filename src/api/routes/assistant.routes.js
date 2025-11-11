// src/api/routes/assistant.routes.js
const express = require('express');
const router = express.Router();
const assistantController = require('../controllers/assistant.controller.js');

// Importe seu middleware de autenticação (baseado na sua estrutura)
const authMiddleware = require('../middlewares/auth.middleware.js');

// Rota principal do chat
// Todas as mensagens do assistente passarão por aqui
router.post(
  '/chat',
  authMiddleware.verifyToken, // Protegendo o endpoint
  assistantController.handleChat
);

module.exports = router;