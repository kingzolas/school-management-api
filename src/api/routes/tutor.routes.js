// C:\... \src\api\routes\tutor.routes.js

const express = require('express');
const router = express.Router();
const tutorController = require('../controllers/tutor.controller');

// Rota para buscar todos os tutores
router.get('/', tutorController.getAll);

// Rota para buscar um tutor pelo CPF
router.get('/cpf/:cpf', tutorController.findByCpf);

// Rota para buscar um tutor por ID
router.get('/:id', tutorController.getById);

// Rota para ATUALIZAR um tutor
router.put('/:id', tutorController.update);

// --- REMOVA AS LINHAS ABAIXO DESTE ARQUIVO ---
// router.put(
//     '/students/:studentId/tutors/:tutorId',
//     studentController.updateTutorRelationship
// );

module.exports = router;