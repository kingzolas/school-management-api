const express = require('express');
const router = express.Router();
const horarioController = require('../controllers/horario.controller');
const authMiddleware = require('../middlewares/auth.middleware');
// const roleMiddleware = require('../middlewares/role.middleware'); // Descomente se tiver

// Criar novo horário (Protegido - Ex: Admin/Coordenador)
router.post(
    '/',
    [authMiddleware.verifyToken /*, roleMiddleware.isAdminOrCoordinator */],
    horarioController.create
);

// Listar horários (com filtros: ?classId=... ou ?teacherId=...)
// (Protegido - Todos autenticados podem ver a grade)
router.get(
    '/',
    [authMiddleware.verifyToken],
    horarioController.getAll
);

// Obter detalhes de um horário específico (Protegido)
router.get(
    '/:id',
    [authMiddleware.verifyToken],
    horarioController.getById
);

// Atualizar um horário (Protegido - Ex: Admin/Coordenador)
router.patch(
    '/:id',
    [authMiddleware.verifyToken /*, roleMiddleware.isAdminOrCoordinator */],
    horarioController.update
);

// Deletar um horário (Protegido - Ex: Admin/Coordenador)
router.delete(
    '/:id',
    [authMiddleware.verifyToken /*, roleMiddleware.isAdminOrCoordinator */],
    horarioController.delete
);

module.exports = router;
