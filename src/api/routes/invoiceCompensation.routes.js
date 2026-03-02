const router = require('express').Router();
const ctrl = require('../controllers/invoiceCompensation.controller');
// const auth = require('../middlewares/auth'); // adapte

// router.use(auth);

router.post('/', ctrl.create);
router.get('/', ctrl.list);
router.patch('/:id/resolve', ctrl.resolve);
router.patch('/:id/cancel', ctrl.cancel);

module.exports = router;