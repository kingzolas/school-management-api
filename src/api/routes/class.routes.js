// src/api/routes/class.routes.js
const express = require('express');
const router = express.Router();
const ClassController = require('../controllers/class.controller');
// 1. IMPORTAR O MIDDLEWARE
const authMiddleware = require('../middlewares/auth.middleware');

// 2. ADICIONAR O 'authMiddleware.verifyToken' EM TODAS AS ROTAS
router.post('/', authMiddleware.verifyToken, ClassController.create);
router.get('/', authMiddleware.verifyToken, ClassController.getAll); // <-- A ROTA QUE ESTÁ FALHANDO
router.get('/:id', authMiddleware.verifyToken, ClassController.getById);
router.patch('/:id', authMiddleware.verifyToken, ClassController.update);
router.delete('/:id', authMiddleware.verifyToken, ClassController.delete);

module.exports = router;