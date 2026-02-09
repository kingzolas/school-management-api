const mongoose = require('mongoose');
const Student = require('../models/student.model');
const Invoice = require('../models/invoice.model');
const Staff = require('../models/user.model'); 
const ClassModel = require('../models/class.model');
const Subject = require('../models/subject.model');
const Expense = require('../models/expense.model');

class DashboardService {

    async getDashboardData(schoolId) {
        console.log(`📊 [DashboardService] Iniciando busca completa para SchoolID: ${schoolId}`);
        
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
        const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
        const endOfMonth = new Date(startOfMonth); endOfMonth.setMonth(endOfMonth.getMonth() + 1);

        const schoolObjectId = new mongoose.Types.ObjectId(schoolId);

        // Executa todas as queries em paralelo
        const [
            studentCount,
            totalTeachers,
            totalClasses,
            totalSubjects,
            financialMetrics,
            expenseMetrics,
            financialHistory,
            birthdays,
            classDistribution,
            dailyChart // <--- NOVO: Dados diários do mês atual
        ] = await Promise.all([
            // 1. Contagem de Alunos Ativos
            Student.countDocuments({ school_id: schoolId, isActive: true }),
            
            // 2. Contagem de Professores
            Staff.countDocuments({ school_id: schoolId, $or: [{ role: 'teacher' }, { roles: { $in: ['Professor', 'Teacher', 'teacher'] } }] }),
            
            // 3. Contagem de Turmas
            ClassModel.countDocuments({ school_id: schoolId }),
            
            // 4. Contagem de Disciplinas
            Subject.countDocuments({ school_id: schoolId }),
            
            // 5. Métricas Financeiras (Entradas/Inadimplência)
            this._calculateFinancials(schoolObjectId, startOfDay, endOfDay, startOfMonth, endOfMonth),
            
            // 6. Métricas de Despesas (Saídas)
            this._calculateExpenses(schoolObjectId, startOfMonth, endOfMonth),
            
            // 7. Histórico Financeiro para o Gráfico de Linhas (6 Meses)
            this._getFinancialHistory(schoolObjectId),

            // 8. Aniversariantes do Mês
            this._getBirthdays(schoolObjectId),

            // 9. Distribuição de Alunos por Turma
            this._getClassDistribution(schoolObjectId),

            // 10. Gráfico Diário do Mês Atual (Barras)
            this._getCurrentMonthDaily(schoolObjectId)
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
            chartData: financialHistory, // Gráfico de Linhas (Histórico)
            dailyChart: dailyChart,      // Gráfico de Barras (Diário)
            classData: classDistribution,
            birthdays: birthdays
        };
    }

    // --- Métodos Privados de Cálculo ---

    async _calculateFinancials(schoolId, startOfDay, endOfDay, startOfMonth, endOfMonth) {
        const metrics = await Invoice.aggregate([
            { $match: { school_id: schoolId } }, 
            {
                $group: {
                    _id: null,
                    totalOverdueValue: { 
                        $sum: { 
                            $cond: [ 
                                { $and: [{ $eq: ["$status", "pending"] }, { $lt: ["$dueDate", new Date()] }] }, 
                                { $divide: ["$value", 100] }, 
                                0 
                            ] 
                        } 
                    },
                    countOverdueStudents: { 
                        $addToSet: { 
                            $cond: [ 
                                { $and: [{ $eq: ["$status", "pending"] }, { $lt: ["$dueDate", new Date()] }] }, 
                                "$student", 
                                null 
                            ] 
                        } 
                    },
                    balanceDay: { 
                        $sum: { 
                            $cond: [ 
                                { $and: [{ $eq: ["$status", "paid"] }, { $gte: ["$paidAt", startOfDay] }, { $lte: ["$paidAt", endOfDay] }] }, 
                                { $divide: ["$value", 100] }, 
                                0 
                            ] 
                        } 
                    },
                    dueDayCount: { 
                        $sum: { 
                            $cond: [ 
                                { $and: [{ $gte: ["$dueDate", startOfDay] }, { $lte: ["$dueDate", endOfDay] }] }, 
                                1, 
                                0 
                            ] 
                        } 
                    },
                    balanceMonth: { 
                        $sum: { 
                            $cond: [ 
                                { $and: [{ $eq: ["$status", "paid"] }, { $gte: ["$paidAt", startOfMonth] }, { $lte: ["$paidAt", endOfMonth] }] }, 
                                { $divide: ["$value", 100] }, 
                                0 
                            ] 
                        } 
                    },
                    totalPendingValue: { 
                        $sum: { 
                            $cond: [
                                { $eq: ["$status", "pending"] }, 
                                { $divide: ["$value", 100] }, 
                                0
                            ] 
                        } 
                    }
                }
            }
        ]);

        const result = metrics[0] || {};
        const uniqueOverdueStudents = result.countOverdueStudents ? result.countOverdueStudents.filter(id => id !== null).length : 0;
        
        const taxa = (result.totalOverdueValue > 0 && result.totalPendingValue > 0) 
            ? ((result.totalOverdueValue / result.totalPendingValue) * 100).toFixed(1) 
            : "0.0";

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
        const result = await Expense.aggregate([
            { $match: { schoolId: schoolId } },
            {
                $group: {
                    _id: null,
                    totalMonth: { 
                        $sum: { 
                            $cond: [ 
                                { $and: [ { $gte: ["$date", startOfMonth] }, { $lte: ["$date", endOfMonth] } ]}, 
                                "$amount", 
                                0 
                            ] 
                        } 
                    },
                    totalPending: { 
                        $sum: { 
                            $cond: [
                                { $eq: ["$status", "pending"] }, 
                                "$amount", 
                                0
                            ] 
                        } 
                    }
                }
            }
        ]);
        return result[0] || { totalMonth: 0, totalPending: 0 };
    }

    async _getFinancialHistory(schoolId) {
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
            if (historyMap.has(key)) {
                const entry = historyMap.get(key);
                entry.income = item.total;
            }
        });

        expenses.forEach(item => {
            const key = `${item._id.year}-${item._id.month}`;
            if (historyMap.has(key)) {
                const entry = historyMap.get(key);
                entry.expense = item.total;
            }
        });

        return Array.from(historyMap.values()).sort((a, b) => {
            if (a.year !== b.year) return a.year - b.year;
            return a.month - b.month;
        });
    }

    // --- NOVO: Lógica para o gráfico diário ---
    async _getCurrentMonthDaily(schoolId) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        // Busca apenas faturas PAGAS no mês atual
        const dailyData = await Invoice.aggregate([
            { 
                $match: { 
                    school_id: schoolId, 
                    status: 'paid', 
                    paidAt: { $gte: startOfMonth, $lte: endOfMonth } 
                } 
            },
            { 
                $group: { 
                    _id: { day: { $dayOfMonth: "$paidAt" } }, 
                    total: { $sum: { $divide: ["$value", 100] } } 
                } 
            },
            { $sort: { "_id.day": 1 } }
        ]);

        const daysInMonth = endOfMonth.getDate();
        const fullMonthData = [];
        const dataMap = new Map();
        
        dailyData.forEach(d => dataMap.set(d._id.day, d.total));

        // Preenche dias sem movimento com 0 para o gráfico não ficar buraco
        for (let day = 1; day <= daysInMonth; day++) {
            fullMonthData.push({
                day: day,
                value: dataMap.get(day) || 0.0
            });
        }

        return fullMonthData;
    }

    async _getBirthdays(schoolId) {
        const currentMonth = new Date().getMonth() + 1; 
        return await Student.aggregate([
            { $match: { school_id: schoolId, isActive: true, $expr: { $eq: [{ $month: "$birthDate" }, currentMonth] } } },
            { $project: { fullName: 1, birthDate: 1, profilePicture: 1 } },
            { $sort: { birthDate: 1 } }, 
            { $limit: 5 } 
        ]);
    }

    async _getClassDistribution(schoolId) {
        const result = await Student.aggregate([
            { $match: { school_id: schoolId, isActive: true } },
            { 
                $group: { 
                    _id: "$class_id", 
                    count: { $sum: 1 } 
                } 
            },
            {
                $lookup: {
                    from: "classes",
                    localField: "_id",
                    foreignField: "_id",
                    as: "classInfo"
                }
            },
            { $unwind: "$classInfo" },
            { 
                $project: { 
                    className: "$classInfo.name", 
                    count: 1 
                } 
            },
            { $sort: { count: -1 } }
        ]);

        const totalStudents = result.reduce((acc, curr) => acc + curr.count, 0);
        
        return result.map(item => ({
            className: item.className,
            studentCount: item.count,
            percentage: totalStudents > 0 ? ((item.count / totalStudents) * 100).toFixed(1) : "0"
        }));
    }
}

module.exports = new DashboardService();