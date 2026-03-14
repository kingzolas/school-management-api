// src/api/routes/gemini-exam.routes.js

const express = require('express');
const router = express.Router();
const geminiExamController = require('../controllers/gemini-exam.controller');
// const authMiddleware = require('../middlewares/auth.middleware'); // Proteção da rota!
const { verifyToken } = require('../middlewares/auth.middleware');

// Rota POST para gerar a prova. 
// Passando o verifyToken para garantir que só usuários logados possam usar a IA
router.post('/generate', verifyToken, geminiExamController.generateQuestions);
module.exports = router;