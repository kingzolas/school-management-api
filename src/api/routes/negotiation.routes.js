const express = require('express');
const router = express.Router();
const NegotiationController = require('../controllers/negotiation.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// ==================================================
// 🔒 ROTAS INTERNAS (Gestor/Admin) - Protegidas
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
// 🔓 ROTAS PÚBLICAS (Aluno/Responsável via Link) - Token como chave
// ==================================================
const publicRouter = express.Router();

/**
 * POST /api/negotiations/public/validate/:token
 */
publicRouter.post('/validate/:token', NegotiationController.validateAccess);

/**
 * POST /api/negotiations/public/pay/:token
 */
publicRouter.post('/pay/:token', NegotiationController.generatePayment);

/**
 * GET /api/negotiations/public/status/:token
 */
publicRouter.get('/status/:token', NegotiationController.getNegotiationStatus);


// --- Montagem Final ---
router.use('/internal', internalRouter);
router.use('/public', publicRouter);

module.exports = router;