const express = require('express');
const router = express.Router();
const controller = require('../controllers/registration-request.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// --- ROTA PÚBLICA (Link do WhatsApp/Site) ---
router.post('/public/submit', controller.createRequest);

// --- ROTAS PRIVADAS (Dashboard do Gestor) ---

// [ALTERADO] Agora busca TODAS as solicitações (Pendente, Aprovado, Rejeitado)
// O filtro será feito no Front-end.
router.get('/list', verifyToken, controller.listAll); 

// Rota para salvar a edição dos dados (PUT)
router.put('/:requestId', verifyToken, controller.updateRequestData);

router.post('/:requestId/approve', verifyToken, controller.approveRequest);
router.post('/:requestId/reject', verifyToken, controller.rejectRequest);

module.exports = router;