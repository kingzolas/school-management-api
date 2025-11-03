const express = require('express');
const router = express.Router();
const courseLoadController = require('../controllers/courseLoad.controller.js');

// [CORRIGIDO] Importamos 'verifyToken' por desestruturação, 
// como você definiu no seu module.exports
const { verifyToken } = require('../middlewares/auth.middleware.js');

// [Rota Principal] Salva a matriz curricular inteira (Cria/Atualiza)
// POST /api/course-loads/batch
router.post('/batch', verifyToken, courseLoadController.batchSave);

// [Rota Principal] Busca a matriz curricular de uma turma/período
// GET /api/course-loads?periodoId=...&classId=...
router.get('/', verifyToken, courseLoadController.find);

// Rotas CRUD (Opcionais)
router.post('/', verifyToken, courseLoadController.create);
router.put('/:id', verifyToken, courseLoadController.update);

module.exports = router;