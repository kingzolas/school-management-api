const express = require('express');
const router = express.Router();
const technicalClassMovementController = require('../controllers/technicalClassMovement.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware.verifyToken, technicalClassMovementController.create);
router.get('/', authMiddleware.verifyToken, technicalClassMovementController.getAll);
router.get('/:id', authMiddleware.verifyToken, technicalClassMovementController.getById);

module.exports = router;
