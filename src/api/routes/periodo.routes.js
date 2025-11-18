const router = require('express').Router();
const controller = require('../controllers/periodo.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Prefix: /api/terms (ou /api/periodos, confirme no seu app.js)

// Middleware global para todas as rotas deste arquivo
router.use(verifyToken);

router.post('/', controller.create);
router.get('/', controller.getAll);
router.get('/:id', controller.getById);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;