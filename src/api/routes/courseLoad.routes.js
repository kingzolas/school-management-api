// src/api/routes/courseLoad.routes.js
const express = require('express');
const router = express.Router();
const courseLoadController = require('../controllers/courseLoad.controller.js');
const { verifyToken } = require('../middlewares/auth.middleware.js');

router.use(verifyToken); // Aplica a autenticação a todas as rotas

// [Rota Principal] Salva a matriz curricular inteira (Cria/Atualiza)
router.post('/batch', courseLoadController.batchSave);

// [Rota Principal] Busca a matriz curricular de uma turma/período
router.get('/', courseLoadController.find);

// Rotas CRUD (Opcionais)
router.post('/', courseLoadController.create);
router.put('/:id', courseLoadController.update);

module.exports = router;