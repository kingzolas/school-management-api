const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expense.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Todas as rotas de despesas exigem autenticação
router.use(verifyToken);

// Rota: /api/expenses (supondo que você registre assim no app.js)

// Criar e Listar
router.post('/', expenseController.create);
router.get('/', expenseController.list);

// Operações por ID
router.get('/:id', expenseController.getById);
router.put('/:id', expenseController.update);
router.delete('/:id', expenseController.remove);

module.exports = router;