const express = require('express');
const multer = require('multer');

const router = express.Router();
const companyController = require('../controllers/company.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});

router.post('/', authMiddleware.verifyToken, upload.single('logo'), companyController.create);
router.get('/', authMiddleware.verifyToken, companyController.getAll);
router.get('/:id/logo', authMiddleware.verifyToken, companyController.getLogo);
router.get('/:id', authMiddleware.verifyToken, companyController.getById);
router.patch('/:id', authMiddleware.verifyToken, upload.single('logo'), companyController.update);
router.patch('/:id/inactivate', authMiddleware.verifyToken, companyController.inactivate);

module.exports = router;
