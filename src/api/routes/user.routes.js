const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth.middleware'); // Assumindo que você criou este middleware

// --- Rota de Criação de Funcionário (Nova) ---
// Rota específica para criar um funcionário (Professor, Admin, etc.)
// Protegida por autenticação (e, idealmente, por role de Admin)
router.post(
    '/staff', 
    [authMiddleware.verifyToken /*, roleMiddleware.isAdmin */], 
    userController.createStaff
);

// --- Rota de Criação de Usuário Simples (Mantida) ---
// Rota original. Pode ser usada para um registro de usuário simples (ex: portal do aluno/tutor)
router.post('/', userController.create); // Mantida sem auth, caso seja pública

// --- Rotas de Gerenciamento de Usuários (Atualizadas) ---

// Rota para buscar todos os usuários (agora populados com perfis)
router.get(
    '/', 
    [authMiddleware.verifyToken],
    userController.getAll
);

// Rota para buscar um usuário por ID (agora populado com perfil)
router.get(
    '/:id', 
    [authMiddleware.verifyToken],
    userController.getById
);

// Rota para atualizar um usuário E seu perfil de trabalho
router.patch(
    '/:id', 
    [authMiddleware.verifyToken /*, roleMiddleware.isAdmin */],
    userController.updateStaff
);

// Rota para INATIVAR um usuário (substitui o DELETE)
router.patch(
    '/:id/inactivate', 
    [authMiddleware.verifyToken /*, roleMiddleware.isAdmin */],
    userController.inactivate
);

// A rota DELETE original foi removida para seguir a regra de "Inativar"
// router.delete('/:id', [authMiddleware.verifyToken], userController.delete);

module.exports = router;