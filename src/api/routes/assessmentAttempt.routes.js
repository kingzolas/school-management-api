const express = require('express');
const router = express.Router();
const assessmentAttemptController = require('../controllers/assessmentAttempt.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware.verifyToken);

// Aluno inicia
router.post('/start', assessmentAttemptController.start);

// Aluno envia
router.post('/:attemptId/submit', assessmentAttemptController.submit);

// Professor vê resultados
router.get('/assessment/:assessmentId/results', assessmentAttemptController.getAssessmentResults);

module.exports = router;