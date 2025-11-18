// src/api/routes/invoice.routes.js
const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Aplica verifyToken em todas as rotas (que são internas/gestoras)
router.use(verifyToken);

// Rota para criar uma nova fatura
router.post(
  '/', 
  invoiceController.create
);

// Rota para buscar TODAS as faturas
router.get(
  '/', 
  invoiceController.getAll
);

// --- ROTA DE CONSULTA DO MERCADO PAGO ---
router.get(
  '/mp/:paymentId',
  invoiceController.checkMpStatus
);

// --- ROTAS ESPECÍFICAS ---

// Rota para buscar todas as faturas de UM ALUNO
router.get(
  '/student/:studentId', 
  invoiceController.getByStudent
);

// Rota para cancelar uma fatura
router.put(
  '/:id/cancel', 
  invoiceController.cancel
);

// Rota para buscar UMA fatura pelo ID do MongoDB
router.get(
  '/:id', 
  invoiceController.getById
);

module.exports = router;