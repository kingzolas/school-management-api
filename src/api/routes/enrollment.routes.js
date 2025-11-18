// src/api/routes/enrollment.routes.js
const express = require('express');
const router = express.Router();
const enrollmentController = require('../controllers/enrollment.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// --- Middleware para todas as rotas ---
router.use(authMiddleware.verifyToken);

// Criar nova matrícula
router.post('/', enrollmentController.create);

// Listar matrículas
router.get('/', enrollmentController.getAll);

// Obter detalhes de uma matrícula
router.get('/:id', enrollmentController.getById);

// Atualizar uma matrícula
router.patch('/:id', enrollmentController.update);

// Deletar (cancelar) uma matrícula
router.delete('/:id', enrollmentController.delete);

module.exports = router;