// src/api/routes/horario.routes.js
const express = require('express');
const router = express.Router();
const horarioController = require('../controllers/horario.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// --- Middleware para todas as rotas ---
router.use(authMiddleware.verifyToken);

// Criar múltiplos horários (Lote)
router.post(
    '/bulk',
    horarioController.createBulk
);

// Criar novo horário
router.post(
    '/',
    horarioController.create
);

// Listar horários
router.get(
    '/',
    horarioController.getAll
);

// Obter detalhes de um horário específico
router.get(
    '/:id',
    horarioController.getById
);

// Atualizar um horário
router.patch(
    '/:id',
    horarioController.update
);

// Deletar um horário
router.delete(
    '/:id',
    horarioController.delete
);

module.exports = router;