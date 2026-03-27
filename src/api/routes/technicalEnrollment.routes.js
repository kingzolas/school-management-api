const express = require('express');
const router = express.Router();
const technicalEnrollmentController = require('../controllers/technicalEnrollment.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware.verifyToken, technicalEnrollmentController.create);
router.get('/', authMiddleware.verifyToken, technicalEnrollmentController.getAll);
router.get('/:id/progress', authMiddleware.verifyToken, technicalEnrollmentController.getProgress);
router.get('/:id', authMiddleware.verifyToken, technicalEnrollmentController.getById);
router.patch('/:id', authMiddleware.verifyToken, technicalEnrollmentController.update);

module.exports = router;
