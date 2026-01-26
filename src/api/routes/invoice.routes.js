const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.use(verifyToken);

// --- ROTA DE IMPRESSÃO EM LOTE (NOVA) ---
// Coloque antes das rotas /:id para evitar conflito
router.post(
  '/batch-print',
  invoiceController.batchPrint
);

// Rota para criar uma nova fatura
router.post('/', invoiceController.create);

// Rota para buscar TODAS as faturas
router.get('/', invoiceController.getAll);

// Rota de consulta Mercado Pago
router.get('/mp/:paymentId', invoiceController.checkMpStatus);

// Rotas Específicas
router.get('/student/:studentId', invoiceController.getByStudent);
router.put('/:id/cancel', invoiceController.cancel);

// Rota por ID (deixe por último)
router.get('/:id', invoiceController.getById);

module.exports = router;