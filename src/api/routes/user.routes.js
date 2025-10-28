const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth.middleware'); // Garanta que este caminho está correto

// --- Rota de Criação de Funcionário (Nova) ---
// (Admin)
router.post(
    '/staff', 
    [authMiddleware.verifyToken /*, roleMiddleware.isAdmin */], // Protegida
    userController.createStaff
);

// --- Rota de Criação de Usuário Simples (Mantida) ---
// (Pode ser pública ou protegida, dependendo da sua regra)
router.post(
    '/', 
    userController.create
);

// --- Rotas de Gerenciamento (Protegidas) ---

// (Auth)
router.get(
    '/', 
    [authMiddleware.verifyToken],
    userController.getAll
);

// (Auth)
router.get(
    '/:id', 
    [authMiddleware.verifyToken],
    userController.getById
);

// (Auth, Admin)
// Esta é a linha 36 (ou próxima). Ela chama 'userController.update'
router.patch(
    '/:id', 
    [authMiddleware.verifyToken /*, roleMiddleware.isAdmin */],
    userController.update // Esta função DEVE existir no controller
);

// (Auth, Admin)
router.patch(
    '/:id/inactivate', 
    [authMiddleware.verifyToken /*, roleMiddleware.isAdmin */],
    userController.inactivate // Esta função DEVE existir no controller
);

// A rota DELETE original foi removida para seguir a regra de "Inativar"

module.exports = router;