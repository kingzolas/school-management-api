const express = require('express');
const router = express.Router();
const assessmentAttemptController = require('../controllers/assessmentAttempt.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware.verifyToken);

// ==============================================================================
// 🎓 ROTAS DO ALUNO (Execução)
// ==============================================================================

// Inicia uma prova (Start)
// POST /api/attempts/start
// Body: { assessmentId: "..." }
router.post('/start', assessmentAttemptController.start);

// Finaliza e Envia a prova (Submit)
// POST /api/attempts/:attemptId/submit
// Body: { answers: [...], telemetry: {...} }
router.post('/:attemptId/submit', assessmentAttemptController.submit);


// ==============================================================================
// 📊 ROTAS DO PROFESSOR (Analytics)
// ==============================================================================

// Busca o ranking/resultados de uma prova específica
// GET /api/attempts/assessment/:assessmentId/results
router.get('/assessment/:assessmentId/results', assessmentAttemptController.getAssessmentResults);

module.exports = router;