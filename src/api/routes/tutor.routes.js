const express = require('express');
const router = express.Router();
const tutorController = require('../controllers/tutor.controller');

// Rota para buscar todos os tutores
// GET /api/tutors/
router.get('/', tutorController.getAll);

// Rota para buscar um tutor pelo CPF (A sua rota!)
// GET /api/tutors/cpf/12345678900
// IMPORTANTE: Esta rota específica deve vir ANTES da rota '/:id'
router.get('/cpf/:cpf', tutorController.findByCpf);

// Rota para buscar um tutor por ID
// GET /api/tutors/60f8d...
router.get('/:id', tutorController.getById);

// (Aqui você pode adicionar as rotas POST, PATCH, DELETE no futuro)

module.exports = router;