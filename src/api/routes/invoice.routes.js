const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Rota para criar uma nova fatura
// POST /api/invoices
router.post(
  '/', 
  verifyToken, 
  invoiceController.create
);

// Rota para buscar TODAS as faturas
// GET /api/invoices
router.get(
  '/', 
  verifyToken, 
  invoiceController.getAll
);

// --- ROTA DE CONSULTA DO MERCADO PAGO ---
// GET /api/invoices/mp/:paymentId
router.get(
  '/mp/:paymentId',
  verifyToken,
  invoiceController.checkMpStatus
);

// --- ROTAS ESPECÍFICAS ---

// Rota para buscar todas as faturas de UM ALUNO
// GET /api/invoices/student/:studentId
router.get(
  '/student/:studentId', 
  verifyToken, 
  invoiceController.getByStudent
);

// Rota para cancelar uma fatura
// [IMPORTANTE] Mudado para PUT para alinhar com o código Flutter
// PUT /api/invoices/:id/cancel
router.put(
  '/:id/cancel', 
  verifyToken, 
  invoiceController.cancel
);

// Rota para buscar UMA fatura pelo ID do MongoDB
// (Geralmente deixamos rotas com :id por último para evitar conflitos)
// GET /api/invoices/:id
router.get(
  '/:id', 
  verifyToken, 
  invoiceController.getById
);

module.exports = router;