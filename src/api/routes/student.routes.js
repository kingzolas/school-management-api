// src/api/routes/student.routes.js
const express = require('express');
const router = express.Router();
const studentController = require('../controllers/student.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Criar Aluno
router.post('/', authMiddleware.verifyToken, studentController.create);

// Aniversariantes (VEM ANTES de /:id)
router.get('/birthdays', authMiddleware.verifyToken, studentController.getUpcomingBirthdays);

// Buscar Todos
router.get('/', authMiddleware.verifyToken, studentController.getAll);

// Buscar por ID
router.get('/:id', authMiddleware.verifyToken, studentController.getById);

// Atualizar Aluno
router.patch('/:id', authMiddleware.verifyToken, studentController.update);

// Deletar Aluno
router.delete('/:id', authMiddleware.verifyToken, studentController.delete);

// --- Rotas de Histórico ---
router.post('/:studentId/history', authMiddleware.verifyToken, studentController.addAcademicRecord);
router.put('/:studentId/history/:recordId', authMiddleware.verifyToken, studentController.updateAcademicRecord);
router.delete('/:studentId/history/:recordId', authMiddleware.verifyToken, studentController.deleteAcademicRecord);

// --- Rota de Tutor ---
// [MODIFICADO] Adicionada proteção de auth
router.put('/:studentId/tutors/:tutorId', authMiddleware.verifyToken, studentController.updateTutorRelationship);

module.exports = router;