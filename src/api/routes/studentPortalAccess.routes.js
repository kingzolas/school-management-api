const express = require('express');

const router = express.Router();
const studentPortalAccessController = require('../controllers/studentPortalAccess.controller');

router.get('/student/access-by-token', (req, res) =>
  studentPortalAccessController.consume(req, res)
);

module.exports = router;