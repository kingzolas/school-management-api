const express = require('express');
const router = express.Router();
const technicalProgramController = require('../controllers/technicalProgram.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware.verifyToken, technicalProgramController.create);
router.get('/', authMiddleware.verifyToken, technicalProgramController.getAll);
router.get('/:id', authMiddleware.verifyToken, technicalProgramController.getById);
router.patch('/:id', authMiddleware.verifyToken, technicalProgramController.update);
router.patch('/:id/inactivate', authMiddleware.verifyToken, technicalProgramController.inactivate);

module.exports = router;
