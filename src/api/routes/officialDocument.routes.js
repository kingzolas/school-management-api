const express = require('express');

const officialDocumentController = require('../controllers/officialDocument.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { verifyGuardianToken } = require('../middlewares/guardianAuth.middleware');
const { buildSignedPdfUpload } = require('../middlewares/officialDocumentUpload.middleware');

const router = express.Router();
const uploadSignedPdf = buildSignedPdfUpload('file');

router.post('/', verifyToken, uploadSignedPdf, officialDocumentController.uploadSigned);

router.get('/', verifyToken, officialDocumentController.listSchool);
router.get('/guardian/mine', verifyGuardianToken, officialDocumentController.listGuardian);
router.get('/student/mine', verifyToken, officialDocumentController.listStudent);

router.get('/guardian/mine/:id', verifyGuardianToken, officialDocumentController.getGuardianById);
router.get('/student/mine/:id', verifyToken, officialDocumentController.getStudentById);

router.get('/guardian/mine/:id/file', verifyGuardianToken, officialDocumentController.downloadGuardianFile);
router.get('/student/mine/:id/file', verifyToken, officialDocumentController.downloadStudentFile);
router.post('/guardian/mine/:id/downloaded', verifyGuardianToken, officialDocumentController.recordGuardianDownload);
router.post('/student/mine/:id/downloaded', verifyToken, officialDocumentController.recordStudentDownload);

router.post('/:id/publish', verifyToken, officialDocumentController.publish);
router.patch('/:id/visibility', verifyToken, officialDocumentController.updateVisibility);
router.post('/:id/replace', verifyToken, uploadSignedPdf, officialDocumentController.replace);
router.post('/:id/downloaded', verifyToken, officialDocumentController.recordSchoolDownload);
router.post('/:id/cancel', verifyToken, officialDocumentController.cancel);
router.get('/:id/file', verifyToken, officialDocumentController.downloadSchoolFile);
router.get('/:id', verifyToken, officialDocumentController.getSchoolById);

module.exports = router;
