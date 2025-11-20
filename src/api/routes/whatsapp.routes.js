const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsapp.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Todas as rotas protegidas pelo token
router.use(verifyToken);

router.get('/connect', whatsappController.connect); // Retorna QR Code
router.get('/status', whatsappController.status);   // Retorna status atual
router.delete('/disconnect', whatsappController.disconnect); // Logout

module.exports = router;