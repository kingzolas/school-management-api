// src/api/routes/school.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');

// --- Importações ---
const SchoolController = require('../controllers/school.controller');
// Importa o OBJETO do middleware de autenticação
const authMiddleware = require('../middlewares/auth.middleware');

// --- Configuração do Multer para Upload de Logo ---
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Limite de 5MB para logos
});

// === ROTAS DE ESCOLA (SCHOOL) ===

/**
 * [PÚBLICO] Cria uma nova escola.
 * * [NOTA DE REMOÇÃO]: Removemos o 'authMiddleware.verifyToken' daqui.
 * Você não pode estar logado (pois seu usuário ainda não tem escola)
 * para criar a primeira escola. Este é o "passo zero".
 */
router.post(
    '/', 
    // authMiddleware.verifyToken, // <-- LINHA REMOVIDA
    upload.single('logo'),     // 1. Processa o upload da imagem
    SchoolController.create      // 2. Passa para o controlador
);

/**
 * [AUTENTICADO] Atualiza uma escola existente.
 * 'upload.single('logo')' permite enviar uma nova logo (opcional).
 */
router.patch(
    '/:id', 
    authMiddleware.verifyToken, 
    upload.single('logo'), 
    SchoolController.update
);

/**
 * [AUTENTICADO] Busca todas as escolas.
 */
router.get(
    '/', 
    authMiddleware.verifyToken, 
    SchoolController.getAll
);

/**
 * [AUTENTICADO] Busca uma escola específica por ID.
 */
router.get(
    '/:id', 
    authMiddleware.verifyToken, 
    SchoolController.getById
);

/**
 * [PÚBLICO] Busca a logo de uma escola por ID.
 */
router.get(
    '/:id/logo', 
    SchoolController.getLogo
);

/**
 * [AUTENTICADO] Inativa uma escola (soft delete).
 */
router.patch(
    '/:id/inactivate', 
    authMiddleware.verifyToken, 
    SchoolController.inactivate
);

module.exports = router;