// src/api/routes/tutor.routes.js
const express = require('express');
const router = express.Router();
const tutorController = require('../controllers/tutor.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.get('/', authMiddleware.verifyToken, tutorController.getAll);
router.get('/cpf/:cpf', authMiddleware.verifyToken, tutorController.findByCpf);

router.get('/:id/financial-score', authMiddleware.verifyToken, tutorController.getFinancialScore);
router.put('/:id/financial-score', authMiddleware.verifyToken, tutorController.updateFinancialScore);
router.post('/:id/financial-score/recalculate', authMiddleware.verifyToken, tutorController.recalculateFinancialScore);
router.post('/financial-score/backfill', authMiddleware.verifyToken, tutorController.backfillFinancialScore);

router.get('/:id', authMiddleware.verifyToken, tutorController.getById);
router.put('/:id', authMiddleware.verifyToken, tutorController.update);

module.exports = router;