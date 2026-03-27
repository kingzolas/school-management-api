const express = require('express');
const router = express.Router();
const technicalEnrollmentOfferingMovementController = require('../controllers/technicalEnrollmentOfferingMovement.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware.verifyToken, technicalEnrollmentOfferingMovementController.create);
router.get('/', authMiddleware.verifyToken, technicalEnrollmentOfferingMovementController.getAll);
router.get('/:id', authMiddleware.verifyToken, technicalEnrollmentOfferingMovementController.getById);

module.exports = router;
