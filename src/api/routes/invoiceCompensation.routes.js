const router = require('express').Router();
const ctrl = require('../controllers/invoiceCompensation.controller');

// ✅ CORREÇÃO AQUI: Importando a função específica 'verifyToken' do seu middleware
const { verifyToken } = require('../middlewares/auth.middleware'); 

// Aplica a proteção em todas as rotas abaixo
router.use(verifyToken);

router.post('/', ctrl.create);
router.get('/', ctrl.list);
router.patch('/:id/resolve', ctrl.resolve);
router.patch('/:id/cancel', ctrl.cancel);

module.exports = router;