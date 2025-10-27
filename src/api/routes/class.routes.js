const express = require('express');
const router = express.Router();
const classController = require('../controllers/class.controller');
const authMiddleware = require('../middlewares/auth.middleware');
// Opcional: Criar um middleware para verificar roles (ex: isAdmin)
// const { isAdmin } = require('../middlewares/role.middleware');

// Criar nova turma (Ex: Somente Admin)
router.post(
    '/',
    [authMiddleware.verifyToken /*, isAdmin */], // Protege a rota
    classController.create
);

// Listar todas as turmas (ou filtradas) (Ex: Todos autenticados)
router.get(
    '/',
    [authMiddleware.verifyToken],
    classController.getAll
);

// Obter detalhes de uma turma (Ex: Todos autenticados)
router.get(
    '/:id',
    [authMiddleware.verifyToken],
    classController.getById
);

// Atualizar uma turma (Ex: Somente Admin)
router.patch(
    '/:id',
    [authMiddleware.verifyToken /*, isAdmin */],
    classController.update
);

// Deletar uma turma (Ex: Somente Admin)
router.delete(
    '/:id',
    [authMiddleware.verifyToken /*, isAdmin */],
    classController.delete
);

module.exports = router;