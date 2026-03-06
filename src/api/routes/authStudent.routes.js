const express = require('express');
const router = express.Router();
const authStudentController = require('../controllers/authStudent.controller');

// Rota: POST /api/auth/student/login
router.post('/login', authStudentController.login);

// Rota: GET /api/auth/student/access-by-token?token=...
router.get('/access-by-token', authStudentController.accessByToken);

module.exports = router;