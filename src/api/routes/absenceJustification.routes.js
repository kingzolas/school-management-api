const express = require('express');
const multer = require('multer');
const router = express.Router();
const absenceJustificationController = require('../controllers/absenceJustification.controller');
const { verifyToken } = require('../middlewares/auth.middleware.js');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

router.use(verifyToken);

router.get('/', absenceJustificationController.list);
router.get('/:id', absenceJustificationController.getById);
router.get('/:id/document', absenceJustificationController.downloadDocument);
router.post('/', upload.single('document'), absenceJustificationController.create);
router.patch('/:id/review', absenceJustificationController.review);

module.exports = router;