const express = require('express');
const router = express.Router();
const resourceOccupancyController = require('../controllers/resourceOccupancy.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware.verifyToken);

router.get('/', resourceOccupancyController.getAll);
router.post('/preview', resourceOccupancyController.preview);

module.exports = router;
