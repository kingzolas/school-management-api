const expenseService = require('../services/expense.service');

// Criar Despesa
const create = async (req, res) => {
    try {
        const schoolId = req.user.schoolId; // Pego do token JWT
        const userId = req.user.id;

        const expenseData = {
            ...req.body,
            schoolId,
            createdBy: userId
        };

        const newExpense = await expenseService.createExpense(expenseData);
        return res.status(201).json(newExpense);
    } catch (error) {
        console.error('Erro ao criar despesa:', error);
        return res.status(500).json({ message: 'Erro interno ao criar despesa.' });
    }
};

// Listar Despesas
const list = async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        // Permite filtrar por query params na URL (ex: ?status=pending&category=Aluguel)
        const filters = req.query; 

        const expenses = await expenseService.getExpenses(schoolId, filters);
        return res.status(200).json(expenses);
    } catch (error) {
        console.error('Erro ao listar despesas:', error);
        return res.status(500).json({ message: 'Erro interno ao buscar despesas.' });
    }
};

// Obter uma despesa específica
const getById = async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const { id } = req.params;

        const expense = await expenseService.getExpenseById(id, schoolId);

        if (!expense) {
            return res.status(404).json({ message: 'Despesa não encontrada.' });
        }

        return res.status(200).json(expense);
    } catch (error) {
        return res.status(500).json({ message: 'Erro ao buscar despesa.' });
    }
};

// Atualizar
const update = async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const { id } = req.params;
        const updateData = req.body;

        const updatedExpense = await expenseService.updateExpense(id, schoolId, updateData);

        if (!updatedExpense) {
            return res.status(404).json({ message: 'Despesa não encontrada para atualização.' });
        }

        return res.status(200).json(updatedExpense);
    } catch (error) {
        return res.status(500).json({ message: 'Erro ao atualizar despesa.' });
    }
};

// Deletar
const remove = async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const { id } = req.params;

        const deletedExpense = await expenseService.deleteExpense(id, schoolId);

        if (!deletedExpense) {
            return res.status(404).json({ message: 'Despesa não encontrada.' });
        }

        return res.status(200).json({ message: 'Despesa removida com sucesso.' });
    } catch (error) {
        return res.status(500).json({ message: 'Erro ao remover despesa.' });
    }
};

module.exports = {
    create,
    list,
    getById,
    update,
    remove
};