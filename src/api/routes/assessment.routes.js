const express = require('express');
const router = express.Router();
const assessmentController = require('../controllers/assessment.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Todas as rotas requerem login (seja professor ou aluno para listar)
router.use(authMiddleware.verifyToken);

// ==============================================================================
// 👩‍🏫 ROTAS DO PROFESSOR (Gestão)
// ==============================================================================

// Cria um rascunho usando IA
// POST /api/assessments/draft
router.post('/draft', assessmentController.createDraft);

// Atualiza/Edita uma avaliação (antes de publicar)
// PATCH /api/assessments/:id
router.patch('/:id', assessmentController.update);

// Publica a avaliação (libera para os alunos)
// PATCH /api/assessments/:id/publish
router.patch('/:id/publish', assessmentController.publish);

// ==============================================================================
// 🏫 ROTAS GERAIS (Listagem)
// ==============================================================================

// Lista avaliações de uma turma específica (Usado pelo App do Aluno e Painel Professor)
// GET /api/assessments/class/:classId
router.get('/class/:classId', assessmentController.getByClass);

// [NOVAS ROTAS]
router.get('/:id', assessmentController.getById); // Pegar detalhes (Preview)
router.delete('/:id', assessmentController.delete); // Excluir

module.exports = router;