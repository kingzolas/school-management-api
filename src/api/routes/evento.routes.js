const express = require('express');
const router = express.Router();
const eventoController = require('../controllers/evento.controller');
const authMiddleware = require('../middlewares/auth.middleware');
// const roleMiddleware = require('../middlewares/role.middleware'); // Descomente se tiver


// --- [NOVA ROTA] ---
// Criar múltiplos eventos (Lote)
router.post(
    '/bulk',
    [authMiddleware.verifyToken],
    eventoController.createBulk
);
// --- FIM DA NOVA ROTA ---

// Criar novo evento (Protegido - Ex: Admin/Professor)
router.post(
    '/',
    [authMiddleware.verifyToken /*, roleMiddleware.isStaff */],
    eventoController.create
);

// Listar eventos (com filtros: ?classId=...&startDate=...&endDate=...)
// (Protegido - Todos autenticados podem ver o calendário)
router.get(
    '/',
    [authMiddleware.verifyToken],
    eventoController.getAll
);

// Obter detalhes de um evento específico (Protegido)
router.get(
    '/:id',
    [authMiddleware.verifyToken],
    eventoController.getById
);

// Atualizar um evento (Protegido - Ex: Admin/Professor)
router.patch(
    '/:id',
    [authMiddleware.verifyToken /*, roleMiddleware.isStaff */],
    eventoController.update
);

// Deletar um evento (Protegido - Ex: Admin/Professor)
router.delete(
    '/:id',
    [authMiddleware.verifyToken /*, roleMiddleware.isStaff */],
    eventoController.delete
);

module.exports = router;