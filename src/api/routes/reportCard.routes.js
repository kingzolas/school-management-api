const express = require('express');
const router = express.Router();

const reportCardController = require('../controllers/reportCard.controller');
// const authMiddleware = require('../middlewares/auth.middleware');
const { verifyToken } = require('../middlewares/auth.middleware');

// Gerar boletins de uma turma para um período
router.post(
  '/generate',
  verifyToken,
  reportCardController.generateClassReportCards
);

// Buscar boletim consolidado de um aluno
router.get(
  '/student',
  verifyToken,
  reportCardController.getStudentReportCard
);

// Buscar boletim por ID
router.get(
  '/:reportCardId',
  verifyToken,
  reportCardController.getReportCardById
);

// Professor lança/atualiza a nota da sua disciplina no boletim
router.patch(
  '/:reportCardId/subjects/:subjectId/score',
  verifyToken,
  reportCardController.updateTeacherSubjectScore
);

// Recalcular status geral do boletim
router.patch(
  '/:reportCardId/recalculate-status',
  verifyToken,
  reportCardController.recalculateReportCardStatus
);

module.exports = router;