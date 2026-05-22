const express = require('express');
const multer = require('multer');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

const manualPaymentReceiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

router.use(verifyToken);

// --- ROTA DE IMPRESSÃO EM LOTE ---
router.post(
  '/batch-print',
  invoiceController.batchPrint
);

// --- ROTA DE REENVIO DE WHATSAPP ---
// Importante: Definida antes de /:id para não conflitar
router.post(
  '/:id/resend',
  invoiceController.resendWhatsapp
);

// Rota para criar uma nova fatura
router.post('/', invoiceController.create);

// Rota para buscar TODAS as faturas
router.get('/', invoiceController.getAll);

// Rota de consulta Mercado Pago
router.get('/mp/:paymentId', invoiceController.checkMpStatus);

// --- [CORREÇÃO] ROTA DE SYNC PENDENTES ---
// ESTA ROTA TEM QUE VIR ANTES DE /:id
// Se vier depois, o express acha que "sync-pending" é um ID
router.get('/sync-pending', invoiceController.syncPending);

// ✅ DEBUG CORA (TEMPORÁRIO)
// IMPORTANTE: antes do "/:id"
router.get('/debug/cora/:externalId', invoiceController.debugCora);

// Rotas Específicas
router.get('/student/:studentId', invoiceController.getByStudent);
router.post(
  '/:id/manual-payment',
  manualPaymentReceiptUpload.single('receipt'),
  invoiceController.registerManualPayment
);
router.get('/:id/manual-payment/receipt', invoiceController.downloadManualPaymentReceipt);
router.put('/:id/cancel', invoiceController.cancel);

// Rota por ID (DEVE FICAR POR ÚLTIMO ENTRE OS GETs)
router.get('/:id', invoiceController.getById);

module.exports = router;
