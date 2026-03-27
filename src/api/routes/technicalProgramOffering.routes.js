const express = require('express');
const router = express.Router();
const technicalProgramOfferingController = require('../controllers/technicalProgramOffering.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware.verifyToken, technicalProgramOfferingController.create);
router.get('/', authMiddleware.verifyToken, technicalProgramOfferingController.getAll);
router.get('/:id', authMiddleware.verifyToken, technicalProgramOfferingController.getById);
router.patch('/:id', authMiddleware.verifyToken, technicalProgramOfferingController.update);

module.exports = router;
