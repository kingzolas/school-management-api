const express = require('express');

const router = express.Router();
const contractController = require('../controllers/contract.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Limita a autenticacao apenas ao namespace de contratos para nao bloquear
// rotas publicas montadas no mesmo prefixo "/api" (ex.: /api/releases/*).
router.use(['/contracts', '/companies/:companyId/contracts'], authMiddleware.verifyToken);

router.post('/contracts/templates', contractController.createTemplate);
router.get('/contracts/templates', contractController.listTemplates);
router.post('/contracts/templates/:id/publish', contractController.publishTemplate);
router.post('/contracts/templates/:id/versions', contractController.createTemplateVersion);
router.get('/contracts/templates/:id', contractController.getTemplateById);
router.patch('/contracts/templates/:id', contractController.updateTemplate);

router.post('/contracts', contractController.createContract);
router.get('/contracts', contractController.listContracts);
router.get('/companies/:companyId/contracts', contractController.listContractsByCompany);
router.get('/contracts/:id/document', contractController.downloadDocument);
router.post('/contracts/:id/signature-flow/start', contractController.startSignatureFlow);
router.post('/contracts/:id/signatories/:signatoryId/accept', contractController.acceptSignature);
router.post('/contracts/:id/amendments', contractController.createAmendment);
router.post('/contracts/:id/rescissions', contractController.createRescission);
router.get('/contracts/:id', contractController.getContractById);
router.patch('/contracts/:id', contractController.updateContract);

module.exports = router;
