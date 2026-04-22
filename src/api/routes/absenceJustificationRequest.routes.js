const express = require('express');
const multer = require('multer');

const controller = require('../controllers/absenceJustificationRequest.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { verifyGuardianToken } = require('../middlewares/guardianAuth.middleware');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 5,
  },
});

const attachmentFields = upload.fields([
  { name: 'attachments', maxCount: 5 },
  { name: 'document', maxCount: 1 },
  { name: 'file', maxCount: 1 },
]);

router.post('/guardian', verifyGuardianToken, attachmentFields, controller.createGuardian);
router.get('/guardian/mine', verifyGuardianToken, controller.listGuardian);
router.get('/guardian/mine/:id', verifyGuardianToken, controller.getGuardianById);
router.get(
  '/guardian/mine/:id/attachments/:attachmentId',
  verifyGuardianToken,
  controller.downloadGuardianAttachment
);
router.post('/guardian/mine/:id/cancel', verifyGuardianToken, controller.cancelGuardian);
router.post(
  '/guardian/mine/:id/complement',
  verifyGuardianToken,
  attachmentFields,
  controller.complementGuardian
);

router.get('/', verifyToken, controller.listSchool);
router.get('/:id', verifyToken, controller.getSchoolById);
router.get('/:id/attachments/:attachmentId', verifyToken, controller.downloadSchoolAttachment);
router.post('/:id/approve', verifyToken, controller.approve);
router.post('/:id/partial-approve', verifyToken, controller.partialApprove);
router.post('/:id/reject', verifyToken, controller.reject);
router.post('/:id/request-info', verifyToken, controller.requestInfo);

module.exports = router;
