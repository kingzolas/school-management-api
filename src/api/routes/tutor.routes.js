// src/api/routes/tutor.routes.js
const express = require('express');
const router = express.Router();
const tutorController = require('../controllers/tutor.controller');
const authMiddleware = require('../middlewares/auth.middleware'); // <-- IMPORTAÇÃO

// [MODIFICADO] Adicionada proteção de auth em TODAS as rotas
router.get('/', authMiddleware.verifyToken, tutorController.getAll);
router.get('/cpf/:cpf', authMiddleware.verifyToken, tutorController.findByCpf);
router.get('/:id', authMiddleware.verifyToken, tutorController.getById);
router.put('/:id', authMiddleware.verifyToken, tutorController.update);

module.exports = router;