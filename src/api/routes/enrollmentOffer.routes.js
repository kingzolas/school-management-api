const express = require('express');

const router = express.Router();
const enrollmentOfferController = require('../controllers/enrollmentOffer.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.use(verifyToken);

router.get('/', enrollmentOfferController.list);
router.post('/', enrollmentOfferController.create);
router.get('/:id', enrollmentOfferController.getById);
router.put('/:id', enrollmentOfferController.update);
router.patch('/:id/status', enrollmentOfferController.updateStatus);

module.exports = router;
