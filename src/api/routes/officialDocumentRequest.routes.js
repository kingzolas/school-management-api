const express = require('express');

const officialDocumentRequestController = require('../controllers/officialDocumentRequest.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { verifyGuardianToken } = require('../middlewares/guardianAuth.middleware');

const router = express.Router();

router.post('/', verifyToken, officialDocumentRequestController.createSchool);
router.post('/guardian', verifyGuardianToken, officialDocumentRequestController.createGuardian);
router.post('/student', verifyToken, officialDocumentRequestController.createStudent);

router.get('/', verifyToken, officialDocumentRequestController.listSchool);
router.get('/guardian/mine', verifyGuardianToken, officialDocumentRequestController.listGuardian);
router.get('/student/mine', verifyToken, officialDocumentRequestController.listStudent);

router.get('/guardian/mine/:id', verifyGuardianToken, officialDocumentRequestController.getGuardianById);
router.get('/student/mine/:id', verifyToken, officialDocumentRequestController.getStudentById);

router.post('/guardian/mine/:id/cancel', verifyGuardianToken, officialDocumentRequestController.cancelGuardian);
router.post('/student/mine/:id/cancel', verifyToken, officialDocumentRequestController.cancelStudent);

router.post('/:id/approve', verifyToken, officialDocumentRequestController.approve);
router.post('/:id/reject', verifyToken, officialDocumentRequestController.reject);
router.post('/:id/cancel', verifyToken, officialDocumentRequestController.cancelSchool);
router.patch('/:id/status', verifyToken, officialDocumentRequestController.updateStatus);
router.get('/:id', verifyToken, officialDocumentRequestController.getSchoolById);

module.exports = router;
