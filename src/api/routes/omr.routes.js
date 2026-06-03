const express = require('express');
const router = express.Router();
const { requireOmrDebugAccess } = require('../middlewares/omrDebug.middleware');
const examController = require('../controllers/exam.controller');

router.post('/debug', requireOmrDebugAccess, examController.debugOMRImage);
router.get('/debug/:debugId/files', requireOmrDebugAccess, examController.listOMRDebugFiles);
router.get('/debug/:debugId/file/:filename', requireOmrDebugAccess, examController.downloadOMRDebugFile);
router.get('/debug/:debugId/zip', requireOmrDebugAccess, examController.downloadOMRDebugZip);

module.exports = router;
