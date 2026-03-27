const express = require('express');
const router = express.Router();
const technicalProgramModuleController = require('../controllers/technicalProgramModule.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware.verifyToken, technicalProgramModuleController.create);
router.get('/', authMiddleware.verifyToken, technicalProgramModuleController.getAll);
router.get('/:id', authMiddleware.verifyToken, technicalProgramModuleController.getById);
router.patch('/:id', authMiddleware.verifyToken, technicalProgramModuleController.update);
router.patch('/:id/inactivate', authMiddleware.verifyToken, technicalProgramModuleController.inactivate);

module.exports = router;
