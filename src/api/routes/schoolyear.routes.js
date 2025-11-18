const router = require('express').Router();
const controller = require('../controllers/schoolyear.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Todas as rotas são protegidas e exigem login (para pegar o school_id)
router.use(verifyToken);

router.post('/', controller.create);
router.get('/', controller.getAll);
router.get('/:id', controller.getById);
router.put('/:id', controller.update); // ou .patch
router.delete('/:id', controller.remove);

module.exports = router;