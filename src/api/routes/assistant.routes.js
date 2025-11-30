// src/api/routes/assistant.routes.js
const express = require('express');
const router = express.Router();
// Certifique-se que o controller está sendo importado corretamente
const assistantController = require('../controllers/assistant.controller.js'); 
const authMiddleware = require('../middlewares/auth.middleware.js');

router.post(
  '/chat', // Mudei para /query para bater com a lógica, mas pode manter /chat se preferir
  authMiddleware.verifyToken,
  // AQUI ESTÁ O ERRO: Mudou de .handleChat para .handleQuery
  assistantController.handleQuery 
);

module.exports = router;