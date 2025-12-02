const mongoose = require('mongoose');
const Student = require('../models/student.model');
const Invoice = require('../models/invoice.model');
const Staff = require('../models/user.model'); 
const ClassModel = require('../models/class.model');
const Subject = require('../models/subject.model');
const Expense = require('../models/expense.model');

class DashboardService {

    async getDashboardData(schoolId) {
        console.log(`📊 [DashboardService] Iniciando busca para SchoolID: ${schoolId}`);
        
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
        const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
        const endOfMonth = new Date(startOfMonth); endOfMonth.setMonth(endOfMonth.getMonth() + 1);

        const schoolObjectId = new mongoose.Types.ObjectId(schoolId);

        // --- CORREÇÃO DA BUSCA DE ALUNOS ---
        // Usamos isActive: true ao invés de status: 'Ativo' pois é o campo do seu model
        const studentCount = await Student.countDocuments({ 
            school_id: schoolId, 
            isActive: true 
        });
        console.log(`🎓 [DashboardService] Alunos ativos encontrados: ${studentCount}`);

        const [
            totalTeachers,
            totalClasses,
            totalSubjects,
            financialMetrics,
            expenseMetrics,
            financialHistory,
            birthdays
        ] = await Promise.all([
            Staff.countDocuments({ school_id: schoolId, $or: [{ role: 'teacher' }, { roles: { $in: ['Professor', 'Teacher', 'teacher'] } }] }),
            ClassModel.countDocuments({ school_id: schoolId }),
            Subject.countDocuments({ school_id: schoolId }),
            this._calculateFinancials(schoolObjectId, startOfDay, endOfDay, startOfMonth, endOfMonth),
            this._calculateExpenses(schoolObjectId, startOfMonth, endOfMonth),
            this._getFinancialHistory(schoolObjectId),
            this._getBirthdays(schoolObjectId)
        ]);

        return {
            counts: {
                students: studentCount, 
                teachers: totalTeachers,
                classes: totalClasses,
                subjects: totalSubjects
            },
            financial: {
                inadimplenciaValor: financialMetrics.inadimplenciaValor,
                inadimplenciaAlunos: financialMetrics.inadimplenciaAlunos,
                inadimplenciaTaxa: financialMetrics.inadimplenciaTaxa,
                saldoDia: financialMetrics.saldoDia,
                vencimentosDiaQtd: financialMetrics.vencimentosDiaQtd,
                saldoMes: financialMetrics.saldoMes,
                totalVencimentosPendentes: financialMetrics.totalVencimentosPendentes,
                despesaMes: expenseMetrics.totalMonth,
                despesaPendente: expenseMetrics.totalPending,
                saldoLiquido: financialMetrics.saldoMes - expenseMetrics.totalMonth
            },
            chartData: financialHistory,
            birthdays: birthdays
        };
    }

    async _calculateFinancials(schoolId, startOfDay, endOfDay, startOfMonth, endOfMonth) {
        // ... (Mesma lógica de agregação do anterior, DIVIDINDO POR 100 SE NECESSÁRIO) ...
        // Se seus Invoices salvam centavos (ex: 65000), mantenha a divisão.
        // Se salvam reais (650.00), remova o $divide.
        // VOU MANTER A DIVISÃO POIS VOCÊ DISSE QUE O BANCO SALVA CENTAVOS.
        const metrics = await Invoice.aggregate([
            { $match: { school_id: schoolId } }, 
            {
                $group: {
                    _id: null,
                    totalOverdueValue: { $sum: { $cond: [ { $and: [{ $eq: ["$status", "pending"] }, { $lt: ["$dueDate", new Date()] }] }, { $divide: ["$value", 100] }, 0 ] } },
                    countOverdueStudents: { $addToSet: { $cond: [ { $and: [{ $eq: ["$status", "pending"] }, { $lt: ["$dueDate", new Date()] }] }, "$student", null ] } },
                    balanceDay: { $sum: { $cond: [ { $and: [{ $eq: ["$status", "paid"] }, { $gte: ["$paidAt", startOfDay] }, { $lte: ["$paidAt", endOfDay] }] }, { $divide: ["$value", 100] }, 0 ] } },
                    dueDayCount: { $sum: { $cond: [ { $and: [{ $gte: ["$dueDate", startOfDay] }, { $lte: ["$dueDate", endOfDay] }] }, 1, 0 ] } },
                    balanceMonth: { $sum: { $cond: [ { $and: [{ $eq: ["$status", "paid"] }, { $gte: ["$paidAt", startOfMonth] }, { $lte: ["$paidAt", endOfMonth] }] }, { $divide: ["$value", 100] }, 0 ] } },
                    totalPendingValue: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, { $divide: ["$value", 100] }, 0] } }
                }
            }
        ]);

        const result = metrics[0] || {};
        const uniqueOverdueStudents = result.countOverdueStudents ? result.countOverdueStudents.filter(id => id !== null).length : 0;
        
        // Taxa fictícia para teste se for zero, ou cálculo real
        const taxa = (result.totalOverdueValue > 0) 
            ? ((result.totalOverdueValue / (result.totalPendingValue + result.totalOverdueValue)) * 100).toFixed(1) 
            : 0;

        return {
            inadimplenciaValor: result.totalOverdueValue || 0,
            inadimplenciaAlunos: uniqueOverdueStudents,
            saldoDia: result.balanceDay || 0,
            vencimentosDiaQtd: result.dueDayCount || 0,
            saldoMes: result.balanceMonth || 0,
            totalVencimentosPendentes: result.totalPendingValue || 0,
            inadimplenciaTaxa: taxa
        };
    }

    async _calculateExpenses(schoolId, startOfMonth, endOfMonth) {
        // Expenses geralmente já são salvas como número float direto ou centavos?
        // Se for centavos, adicione a divisão. Vou assumir float (reais) para Expenses pois criamos agora.
        // Se for centavos, troque "$amount" por { $divide: ["$amount", 100] }
        const result = await Expense.aggregate([
            { $match: { schoolId: schoolId } },
            {
                $group: {
                    _id: null,
                    totalMonth: { $sum: { $cond: [ { $and: [ { $gte: ["$date", startOfMonth] }, { $lte: ["$date", endOfMonth] } ]}, "$amount", 0 ] } },
                    totalPending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] } }
                }
            }
        ]);
        return result[0] || { totalMonth: 0, totalPending: 0 };
    }

    async _getFinancialHistory(schoolId) {
        // Mantém a lógica do gráfico, lembrando de dividir por 100 nos invoices
        const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5); sixMonthsAgo.setDate(1); sixMonthsAgo.setHours(0,0,0,0);

        const incomes = await Invoice.aggregate([
            { $match: { school_id: schoolId, status: 'paid', paidAt: { $gte: sixMonthsAgo } } },
            { $group: { _id: { month: { $month: "$paidAt" }, year: { $year: "$paidAt" } }, total: { $sum: { $divide: ["$value", 100] } } } }
        ]);

        const expenses = await Expense.aggregate([
            { $match: { schoolId: schoolId, date: { $gte: sixMonthsAgo } } },
            { $group: { _id: { month: { $month: "$date" }, year: { $year: "$date" } }, total: { $sum: "$amount" } } }
        ]);

        const historyMap = new Map();
        for (let i = 0; i < 6; i++) {
            const d = new Date(); d.setMonth(d.getMonth() - i);
            const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
            historyMap.set(key, { month: d.getMonth() + 1, year: d.getFullYear(), income: 0, expense: 0 });
        }

        incomes.forEach(item => {
            const key = `${item._id.year}-${item._id.month}`;
            if (historyMap.has(key)) historyMap.get(key).income = item.total;
        });

        expenses.forEach(item => {
            const key = `${item._id.year}-${item._id.month}`;
            if (historyMap.has(key)) historyMap.get(key).expense = item.total;
        });

        return Array.from(historyMap.values()).sort((a, b) => {
            if (a.year !== b.year) return a.year - b.year;
            return a.month - b.month;
        });
    }

    async _getBirthdays(schoolId) {
        const currentMonth = new Date().getMonth() + 1; 
        return await Student.aggregate([
            { $match: { school_id: schoolId, isActive: true, $expr: { $eq: [{ $month: "$birthDate" }, currentMonth] } } }, // Correção aqui também
            { $project: { fullName: 1, birthDate: 1, profilePicture: 1 } },
            { $sort: { birthDate: 1 } }, { $limit: 5 } 
        ]);
    }
}

module.exports = new DashboardService();