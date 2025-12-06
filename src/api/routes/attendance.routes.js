const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendance.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Todas as rotas abaixo requerem autenticação
router.use(verifyToken);

// GET: Busca a lista de chamada (Salva ou Proposta)
// Exemplo: /api/attendance/class/654a...99?date=2023-12-06
router.get('/class/:classId', attendanceController.getAttendanceSheet);

// POST: Salva ou Atualiza a chamada
router.post('/', attendanceController.saveAttendance);
router.get('/history/:classId', attendanceController.getHistory);

module.exports = router;