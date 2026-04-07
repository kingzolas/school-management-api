const express = require('express');

const classActivityController = require('../controllers/classActivity.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(verifyToken);

router.get('/:activityId/submissions', classActivityController.getSubmissions);
router.put(
  '/:activityId/submissions/bulk',
  classActivityController.bulkUpsertSubmissions
);
router.get('/:activityId', classActivityController.getById);
router.patch('/:activityId', classActivityController.update);
router.delete('/:activityId', classActivityController.remove);

module.exports = router;
