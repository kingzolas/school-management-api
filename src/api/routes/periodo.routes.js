const router = require('express').Router();
const controller = require('../controllers/periodo.controller');

// [CORRIGIDO] Importe a função 'verifyToken' de dentro do objeto exportado
const { verifyToken } = require('../middlewares/auth.middleware');

// Prefix: /api/terms

// [CORRIGIDO] Use a função 'verifyToken' diretamente
router.post('/', verifyToken, controller.create);
router.get('/', verifyToken, controller.getAll);
router.get('/:id', verifyToken, controller.getById);
router.put('/:id', verifyToken, controller.update);
router.delete('/:id', verifyToken, controller.remove);

module.exports = router;