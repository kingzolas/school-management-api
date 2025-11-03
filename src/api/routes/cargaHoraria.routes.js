const router = require('express').Router();
const controller = require('../controllers/cargaHoraria.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Prefix: /api/carga-horaria

// [CORREÇÃO] Use verifyToken
const { verifyToken } = authMiddleware; 

router.post('/', verifyToken, controller.create);
router.get('/', verifyToken, controller.getAll);
router.put('/:id', verifyToken, controller.update);
router.delete('/:id', verifyToken, controller.remove);

module.exports = router;