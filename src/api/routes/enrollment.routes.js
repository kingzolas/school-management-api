const express = require('express');
const router = express.Router();
const enrollmentController = require('../controllers/enrollment.controller');
const authMiddleware = require('../middlewares/auth.middleware');
// const { isAdminOrStaff } = require('../middlewares/role.middleware'); // Exemplo

// Criar nova matrícula (Ex: Admin ou Secretaria)
router.post(
    '/',
    [authMiddleware.verifyToken /*, isAdminOrStaff */],
    enrollmentController.create
);

// Listar matrículas (com filtros via query params) (Ex: Todos autenticados)
router.get(
    '/',
    [authMiddleware.verifyToken],
    enrollmentController.getAll
);

// Obter detalhes de uma matrícula (Ex: Todos autenticados)
router.get(
    '/:id',
    [authMiddleware.verifyToken],
    enrollmentController.getById
);

// Atualizar uma matrícula (status, fee) (Ex: Admin ou Secretaria)
router.patch(
    '/:id',
    [authMiddleware.verifyToken /*, isAdminOrStaff */],
    enrollmentController.update
);

// Deletar (cancelar) uma matrícula (Ex: Admin ou Secretaria)
router.delete(
    '/:id',
    [authMiddleware.verifyToken /*, isAdminOrStaff */],
    enrollmentController.delete
);

module.exports = router;