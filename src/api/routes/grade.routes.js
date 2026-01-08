const express = require('express');
const router = express.Router();
const controller = require('../controllers/grade.controller');

// IMPORTAÇÃO CORRETA BASEADA NO SEU CÓDIGO
const { verifyToken } = require('../middlewares/auth.middleware');

// Prefixo: /api/grades
router.post('/bulk', verifyToken, controller.saveBulkGrades);
router.get('/class/:classId', verifyToken, controller.getGradesByClass);

module.exports = router;