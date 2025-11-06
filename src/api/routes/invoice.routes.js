const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');

// [IMPORTANTE] Corrigindo a importação do middleware de auth,
// com base no que você mostrou que é o seu padrão (exportando um objeto)
const { verifyToken } = require('../middlewares/auth.middleware');

// Rota para criar uma nova fatura (POST /api/invoices)
router.post(
  '/', 
  verifyToken, 
  invoiceController.create
);

// Rota para buscar TODAS as faturas (GET /api/invoices)
router.get(
  '/', 
  verifyToken, 
  invoiceController.getAll
);

// --- ROTA DE CONSULTA DO MERCADO PAGO ---
// Esta é a rota que estava faltando e causando o "Cannot GET"
// GET /api/invoices/mp/:paymentId
router.get(
  '/mp/:paymentId', // Rota específica para consulta no MP
  verifyToken,
  invoiceController.checkMpStatus
);

// --- ROTAS GENÉRICAS (DEPOIS DAS ESPECÍFICAS) ---

// Rota para buscar todas as faturas de UM ALUNO
// GET /api/invoices/student/:studentId
router.get(
  '/student/:studentId', 
  verifyToken, 
  invoiceController.getByStudent
);

// Rota para buscar UMA fatura pelo ID do MongoDB
// GET /api/invoices/:id
router.get(
  '/:id', 
  verifyToken, 
  invoiceController.getById
);

// Rota para cancelar uma fatura
// PATCH /api/invoices/:id/cancel
router.patch(
  '/:id/cancel', 
  verifyToken, 
  invoiceController.cancel
);

module.exports = router;