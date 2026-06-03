const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/auth.middleware');
const examController = require('../controllers/exam.controller');

router.post('/debug', verifyToken, examController.debugOMRImage);

module.exports = router;
