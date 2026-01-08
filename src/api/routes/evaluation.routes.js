const express = require('express');
const router = express.Router();
const controller = require('../controllers/evaluation.controller');

// IMPORTAÇÃO CORRETA
const { verifyToken } = require('../middlewares/auth.middleware');

// Prefixo: /api/evaluations
router.get('/class/:classId', verifyToken, controller.getByClass);
router.delete('/:id', verifyToken, controller.delete);

module.exports = router;
