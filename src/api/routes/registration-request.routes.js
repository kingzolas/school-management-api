const express = require('express');
const router = express.Router();
const controller = require('../controllers/registration-request.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// --- ROTA PÚBLICA (Link do WhatsApp/Site) ---
// Não requer token, pois é preenchido externamente
router.post('/public/submit', controller.createRequest);

// --- ROTAS PRIVADAS (Dashboard do Gestor) ---
router.get('/pending', verifyToken, controller.listPending);

// [NOVO] Rota para salvar a edição dos dados (PUT)
// Essa foi a linha que faltava para corrigir o erro FormatException
router.put('/:requestId', verifyToken, controller.updateRequestData);

router.post('/:requestId/approve', verifyToken, controller.approveRequest);
router.post('/:requestId/reject', verifyToken, controller.rejectRequest);

module.exports = router;