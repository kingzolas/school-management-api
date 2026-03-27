const express = require('express');
const router = express.Router();
const technicalSpaceController = require('../controllers/technicalSpace.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware.verifyToken, technicalSpaceController.create);
router.get('/', authMiddleware.verifyToken, technicalSpaceController.getAll);
router.get('/:id', authMiddleware.verifyToken, technicalSpaceController.getById);
router.patch('/:id', authMiddleware.verifyToken, technicalSpaceController.update);
router.patch('/:id/inactivate', authMiddleware.verifyToken, technicalSpaceController.inactivate);

module.exports = router;
