const express = require('express');
const router = express.Router();
const authStudentController = require('../controllers/authStudent.controller');

// Rota: POST /api/auth/student/login
router.post('/login', authStudentController.login);

module.exports = router;