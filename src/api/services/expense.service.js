const mongoose = require('mongoose'); // <--- ADICIONE ESTA LINHA OBRIGATORIAMENTE
const Expense = require('../models/expense.model');
const financeRuntime = require('./school-finance.runtime.js');

// Criar nova despesa
const createExpense = async (expenseData) => {
    const expense = new Expense(expenseData);
    const saved = await expense.save();
    if (saved?.schoolId) {
        financeRuntime.invalidateSchool(saved.schoolId, 'dashboard:financial');
    }
    return saved;
};

// Listar despesas (com filtros opcionais)
const getExpenses = async (schoolId, filters = {}) => {
    const query = { schoolId, ...filters };
    
    // Se houver filtro de data (ex: startDate e endDate vindos do controller)
    if (filters.startDate && filters.endDate) {
        query.date = {
            $gte: new Date(filters.startDate),
            $lte: new Date(filters.endDate)
        };
        // Removemos do query object para não dar erro no Mongo
        delete query.startDate;
        delete query.endDate;
    }

    // Ordena por data (mais recentes primeiro)
    return await Expense.find(query).sort({ date: -1 });
};

// Obter despesa por ID (garantindo que pertence à escola)
const getExpenseById = async (expenseId, schoolId) => {
    return await Expense.findOne({ _id: expenseId, schoolId });
};

// Atualizar despesa
const updateExpense = async (expenseId, schoolId, updateData) => {
    const updated = await Expense.findOneAndUpdate(
        { _id: expenseId, schoolId },
        updateData,
        { new: true } // Retorna o objeto atualizado
    );

    if (updated) {
        financeRuntime.invalidateSchool(schoolId, 'dashboard:financial');
    }

    return updated;
};

// Deletar despesa
const deleteExpense = async (expenseId, schoolId) => {
    const deleted = await Expense.findOneAndDelete({ _id: expenseId, schoolId });

    if (deleted) {
        financeRuntime.invalidateSchool(schoolId, 'dashboard:financial');
    }

    return deleted;
};

// Resumo financeiro rápido (Soma total por status)
const getFinancialSummary = async (schoolId) => {
    return await Expense.aggregate([
        // AGORA VAI FUNCIONAR PORQUE IMPORTAMOS O MONGOOSE LÁ EM CIMA
        { $match: { schoolId: new mongoose.Types.ObjectId(schoolId) } },
        {
            $group: {
                _id: "$status",
                total: { $sum: "$amount" },
                count: { $sum: 1 }
            }
        }
    ]);
};

module.exports = {
    createExpense,
    getExpenses,
    getExpenseById,
    updateExpense,
    deleteExpense,
    getFinancialSummary
};
