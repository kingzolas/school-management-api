const express = require('express');
const router = express.Router();
const subjectController = require('../controllers/subject.controller');
const authMiddleware = require('../middlewares/auth.middleware');
// const roleMiddleware = require('../middlewares/role.middleware'); // Descomente se tiver

// Criar nova disciplina (Protegido - Ex: Admin/Coordenador)
router.post(
    '/',
    [authMiddleware.verifyToken /*, roleMiddleware.isAdminOrCoordinator */],
    subjectController.create
);

// --- [NOVA ROTA] ---
// Criar múltiplas disciplinas (Lote)
router.post(
    '/bulk',
    [authMiddleware.verifyToken /*, roleMiddleware.isAdminOrCoordinator */],
    subjectController.createBulk
);
// --- FIM DA NOVA ROTA ---

// Listar todas as disciplinas (Protegido - Todos autenticados podem ver)
router.get(
    '/',
    [authMiddleware.verifyToken],
    subjectController.getAll
);

// Obter detalhes de uma disciplina (Protegido)
router.get(
    '/:id',
    [authMiddleware.verifyToken],
    subjectController.getById
);

// Atualizar uma disciplina (Protegido - Ex: Admin/Coordenador)
router.patch(
    '/:id',
    [authMiddleware.verifyToken /*, roleMiddleware.isAdminOrCoordinator */],
    subjectController.update
);

// Deletar uma disciplina (Protegido - Ex: Admin/Coordenador)
router.delete(
    '/:id',
    [authMiddleware.verifyToken /*, roleMiddleware.isAdminOrCoordinator */],
    subjectController.delete
);

module.exports = router;