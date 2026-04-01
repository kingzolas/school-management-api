const express = require('express');
const router = express.Router();
const technicalProgramOfferingModuleController = require('../controllers/technicalProgramOfferingModule.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware.verifyToken, technicalProgramOfferingModuleController.create);
router.get('/', authMiddleware.verifyToken, technicalProgramOfferingModuleController.getAll);
router.get('/:id', authMiddleware.verifyToken, technicalProgramOfferingModuleController.getById);
router.patch('/:id', authMiddleware.verifyToken, technicalProgramOfferingModuleController.update);
router.post('/:id/schedule-slots/:slotId/publish', authMiddleware.verifyToken, technicalProgramOfferingModuleController.publishScheduleSlot);
router.patch('/:id/inactivate', authMiddleware.verifyToken, technicalProgramOfferingModuleController.inactivate);

module.exports = router;
