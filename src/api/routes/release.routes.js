const express = require('express');
const router = express.Router();
const ReleaseController = require('../controllers/release.controller');

// Rota pública para o GitHub enviar os dados
// IMPORTANTE: Depois podemos proteger isso com um segredo (Signature), mas vamos começar simples.
router.post('/webhook', ReleaseController.handleGitHubWebhook);

// Rotas para o App consumir
router.get('/', ReleaseController.list); // Lista todas
router.get('/latest', ReleaseController.getLatest); // Pega a última

module.exports = router;