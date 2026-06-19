// src/api/routes/subject.routes.js
const express = require('express');
const router = express.Router();
const subjectController = require('../controllers/subject.controller');
const authMiddleware = require('../middlewares/auth.middleware');
// const roleMiddleware = require('../middlewares/role.middleware'); 

// Criar nova disciplina
router.post(
    '/',
    [authMiddleware.verifyToken],
    subjectController.create
);

// Criar múltiplas disciplinas (Lote)
router.post(
    '/bulk',
    [authMiddleware.verifyToken],
    subjectController.createBulk
);

// Listar todas as disciplinas (da escola do usuário)
router.get(
    '/',
    [authMiddleware.verifyToken],
    subjectController.getAll
);

// VisÃ£o pedagÃ³gica agregada para gestÃ£o de disciplinas
router.get(
    '/management-summary',
    [authMiddleware.verifyToken],
    subjectController.getManagementSummary
);

// Obter detalhes de uma disciplina
router.get(
    '/:id',
    [authMiddleware.verifyToken],
    subjectController.getById
);

// Atualizar uma disciplina
router.patch(
    '/:id',
    [authMiddleware.verifyToken],
    subjectController.update
);

// Deletar uma disciplina
router.delete(
    '/:id',
    [authMiddleware.verifyToken],
    subjectController.delete
);

module.exports = router;
