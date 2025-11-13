const express = require('express');
const router = express.Router();
const NegotiationController = require('../controllers/negotiation.controller');
// Importa especificamente a função 'verifyToken' do middleware
const { verifyToken } = require('../middlewares/auth.middleware');

// ==================================================
// 🔒 ROTAS INTERNAS (Gestor/Admin)
// ==================================================
const internalRouter = express.Router();

// Aplica o middleware de proteção (JWT) em todas as rotas internas
internalRouter.use(verifyToken); 

/**
 * POST /api/negotiations/internal/create
 * Gestor cria uma nova proposta.
 */
internalRouter.post('/create', NegotiationController.createNegotiation);

/**
 * GET /api/negotiations/internal/student/:studentId
 * Lista histórico.
 */
internalRouter.get('/student/:studentId', NegotiationController.listByStudent);


// ==================================================
// 🔓 ROTAS PÚBLICAS (Aluno/Responsável via Link)
// ==================================================
// Não usa verifyToken, pois o usuário acessa via Link externo
const publicRouter = express.Router();

/**
 * POST /api/negotiations/public/validate/:token
 * CORREÇÃO: Inverti a ordem para bater com o Flutter (/validate/TOKEN)
 */
publicRouter.post('/validate/:token', NegotiationController.validateAccess);

/**
 * POST /api/negotiations/public/pay/:token
 * CORREÇÃO: Mudei de 'checkout' para 'pay' e inverti a ordem para bater com o Flutter
 */
publicRouter.post('/pay/:token', NegotiationController.generatePayment);

/**
 * GET /api/negotiations/public/status/:token
 * CORREÇÃO: Inverti a ordem para bater com o Flutter (/status/TOKEN)
 */
publicRouter.get('/status/:token', NegotiationController.getNegotiationStatus);


// --- Montagem Final ---
router.use('/internal', internalRouter);
router.use('/public', publicRouter);

module.exports = router;