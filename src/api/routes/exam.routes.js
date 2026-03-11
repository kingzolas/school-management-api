const express = require('express');
const router = express.Router();
const examController = require('../controllers/exam.controller'); // Ajuste o nome se necessário
// const { authMiddleware } = require('../middlewares/auth.middleware'); // Puxando seu auth
const { verifyToken } = require('../middlewares/auth.middleware');


// Todas as rotas de exames precisam de autenticação (e portanto terão req.user.school_id)
router.use(verifyToken);

// Rotas Base da Prova
router.post('/', examController.create);
router.get('/', examController.getAll);
router.get('/:id', examController.getById);

// Rotas de Operação (Gerar Lote de PDF e Escanear QR Code)
router.post('/:id/generate-sheets', examController.generateSheets);
router.post('/scan', examController.scanSheet);

router.get('/exams/sheet/:uuid/verify', verifyToken, examController.verifySheet);
router.post('/exams/process-omr', verifyToken, examController.processOMRImage);
module.exports = router;