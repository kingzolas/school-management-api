const express = require('express');
const router = express.Router();
const technicalModuleRecordController = require('../controllers/technicalModuleRecord.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware.verifyToken, technicalModuleRecordController.create);
router.get('/', authMiddleware.verifyToken, technicalModuleRecordController.getAll);
router.get('/:id', authMiddleware.verifyToken, technicalModuleRecordController.getById);
router.patch('/:id', authMiddleware.verifyToken, technicalModuleRecordController.update);

module.exports = router;
