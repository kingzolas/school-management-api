const express = require('express');
const router = express.Router();
const studentController = require('../controllers/student.controller');

// [CORREÇÃO] 1. Importe o middleware que você acabou de criar
const authMiddleware = require('../middlewares/auth.middleware');




// Rota para criar um novo aluno
router.post(
    '/', 
    [authMiddleware.verifyToken], // ⬅️ 2. Agora 'authMiddleware' existe e está sendo usado
    studentController.create
);

// --- CORREÇÃO APLICADA AQUI ---
// Rota específica para buscar os próximos aniversariantes (VEM ANTES da rota com :id)
router.get('/birthdays', studentController.getUpcomingBirthdays);

// Rota para buscar todos os alunos
router.get('/', studentController.getAll);

// Rota para buscar um aluno por ID (VEM DEPOIS da rota /birthdays)
router.get('/:id', studentController.getById);

// Rota para atualizar um aluno por ID (Protegida também)
router.patch(
    '/:id', 
    [authMiddleware.verifyToken], 
    studentController.update
);

// Rota para deletar um aluno por ID (Protegida também)
router.delete(
    '/:id', 
    [authMiddleware.verifyToken], 
    studentController.delete
);

// Adiciona um novo registro (Ex: 1º Ano, 2022)
router.post(
    '/:studentId/history',
    [authMiddleware.verifyToken],
    studentController.addAcademicRecord
);

// Atualiza um registro existente (pelo ID do registro)
router.put(
    '/:studentId/history/:recordId',
    [authMiddleware.verifyToken],
    studentController.updateAcademicRecord
);

// Deleta um registro existente
router.delete(
    '/:studentId/history/:recordId',
    [authMiddleware.verifyToken],
    studentController.deleteAcademicRecord
);

module.exports = router;