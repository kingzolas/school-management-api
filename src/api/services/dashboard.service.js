const mongoose = require('mongoose');
const Student = require('../models/student.model');
const Invoice = require('../models/invoice.model');
const Staff = require('../models/user.model'); 
const ClassModel = require('../models/class.model');
const Subject = require('../models/subject.model');
const Expense = require('../models/expense.model');

class DashboardService {

    async getDashboardData(schoolId) {
        console.log(`📊 [DashboardService] Gerando Inteligência Financeira para SchoolID: ${schoolId}`);
        
        const schoolObjectId = new mongoose.Types.ObjectId(schoolId);
        const currentYear = new Date().getFullYear();

        // --- Definição de Datas ---
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
        const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
        const endOfMonth = new Date(startOfMonth); endOfMonth.setMonth(endOfMonth.getMonth() + 1);

        // --- Execução Paralela de Todas as Consultas ---
        const [
            counts,
            financialMetrics,
            expenseMetrics,
            monthlyPerformance,
            dailyChart,
            birthdays,
            classDistribution
        ] = await Promise.all([
            // 1. Contagens Básicas (Alunos, Professores, etc)
            this._getCounts(schoolId),

            // 2. Métricas Financeiras do Mês Atual (Segmentado por Boleto/Pix e Status)
            this._calculateFinancials(schoolObjectId, startOfDay, endOfDay, startOfMonth, endOfMonth),
            
            // 3. Despesas do Mês
            this._calculateExpenses(schoolObjectId, startOfMonth, endOfMonth),
            
            // 4. Inteligência de Negócio: Performance Mensal (Jan vs Fev vs Mar...)
            this._getMonthlyPerformance(schoolObjectId, currentYear),

            // 5. Gráfico Diário (Evolução dia a dia do mês atual)
            this._getCurrentMonthDaily(schoolObjectId),

            // 6. Aniversariantes
            this._getBirthdays(schoolObjectId),

            // 7. Distribuição por Turma
            this._getClassDistribution(schoolObjectId)
        ]);

        // --- Montagem do Objeto de Resposta ---
        return {
            counts: counts,
            
            // Visão do Mês Atual (Operacional)
            financial: {
                // Caixa Realizado (O que entrou)
                saldoDia: financialMetrics.saldoDia,
                saldoMes: financialMetrics.saldoMes,
                
                // Fluxo de Caixa (Previsão vs Atraso)
                totalAVencer: financialMetrics.totalAVencer,     // Receita Futura
                totalVencido: financialMetrics.totalInadimplente, // Receita Travada
                
                // Indicadores de Inadimplência
                inadimplenciaAlunos: financialMetrics.qtdAlunosInadimplentes,
                inadimplenciaTaxa: financialMetrics.inadimplenciaTaxa,
                
                // Segmentação por Método (Cora/Boleto vs MP/Pix)
                metodos: {
                    boleto: {
                        recebido: financialMetrics.boletoRecebido,
                        aReceber: financialMetrics.boletoAVencer,
                        atrasado: financialMetrics.boletoVencido
                    },
                    pix: {
                        recebido: financialMetrics.pixRecebido,
                        aReceber: financialMetrics.pixAVencer,
                        atrasado: financialMetrics.pixVencido
                    }
                },

                // Resultado Líquido
                despesaMes: expenseMetrics.totalMonth,
                despesaPendente: expenseMetrics.totalPending,
                saldoLiquido: financialMetrics.saldoMes - expenseMetrics.totalMonth
            },

            // Visão Estratégica (Evolução Anual)
            history: {
                year: currentYear,
                performance: monthlyPerformance // Array com o comparativo de alunos e receita mês a mês
            },

            // Gráficos Auxiliares
            dailyChart: dailyChart,
            classData: classDistribution,
            birthdays: birthdays
        };
    }

    // =========================================================================
    // MÉTODOS PRIVADOS (CÁLCULOS E AGGREGATIONS)
    // =========================================================================

    async _getCounts(schoolId) {
        const [students, teachers, classes, subjects] = await Promise.all([
            Student.countDocuments({ school_id: schoolId, isActive: true }),
            Staff.countDocuments({ school_id: schoolId, $or: [{ role: 'teacher' }, { roles: { $in: ['Professor', 'Teacher', 'teacher'] } }] }),
            ClassModel.countDocuments({ school_id: schoolId }),
            Subject.countDocuments({ school_id: schoolId })
        ]);
        return { students, teachers, classes, subjects };
    }

    // --- CÁLCULO FINANCEIRO DETALHADO (SEGMENTAÇÃO) ---
   // ... dentro de dashboard.service.js

    async _calculateFinancials(schoolId, startOfDay, endOfDay, startOfMonth, endOfMonth) {
        const now = new Date();
        
        const metrics = await Invoice.aggregate([
            { $match: { school_id: schoolId } }, 
            {
                $group: {
                    _id: null,
                    
                    // --- 1. GERAIS (MANTIDOS) ---
                    totalOverdueValue: { 
                        $sum: { 
                            $cond: [ 
                                { $and: [{ $eq: ["$status", "pending"] }, { $lt: ["$dueDate", now] }] }, 
                                { $divide: ["$value", 100] }, 0 
                            ] 
                        } 
                    },
                    countOverdueStudents: { 
                        $addToSet: { 
                            $cond: [ 
                                { $and: [{ $eq: ["$status", "pending"] }, { $lt: ["$dueDate", now] }] }, 
                                "$student", null 
                            ] 
                        } 
                    },
                    totalFutureValue: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$status", "pending"] }, { $gte: ["$dueDate", now] }] },
                                { $divide: ["$value", 100] }, 0
                            ]
                        }
                    },
                    balanceDay: { 
                        $sum: { 
                            $cond: [ 
                                { $and: [{ $eq: ["$status", "paid"] }, { $gte: ["$paidAt", startOfDay] }, { $lte: ["$paidAt", endOfDay] }] }, 
                                { $divide: ["$value", 100] }, 0 
                            ] 
                        } 
                    },
                    balanceMonth: { 
                        $sum: { 
                            $cond: [ 
                                { $and: [{ $eq: ["$status", "paid"] }, { $gte: ["$paidAt", startOfMonth] }, { $lte: ["$paidAt", endOfMonth] }] }, 
                                { $divide: ["$value", 100] }, 0 
                            ] 
                        } 
                    },
                    
                    // --- CORREÇÃO AQUI: USANDO O CAMPO 'GATEWAY' ---
                    
                    // CORA (Geralmente Boleto)
                    // Soma tudo que entrou via gateway 'cora' OU método 'boleto'
                    boletoPaid: {
                        $sum: { 
                            $cond: [
                                { 
                                    $and: [
                                        { $or: [{ $eq: ["$gateway", "cora"] }, { $eq: ["$paymentMethod", "boleto"] }] }, 
                                        { $eq: ["$status", "paid"] }, 
                                        { $gte: ["$paidAt", startOfMonth] } // Recebido no mês atual
                                    ] 
                                }, 
                                { $divide: ["$value", 100] }, 
                                0
                            ] 
                        }
                    },

                    // MERCADO PAGO (Geralmente Pix)
                    // Soma tudo que entrou via gateway 'mercadopago' OU método 'pix'
                    pixPaid: {
                        $sum: { 
                            $cond: [
                                { 
                                    $and: [
                                        { $or: [{ $eq: ["$gateway", "mercadopago"] }, { $eq: ["$paymentMethod", "pix"] }] }, 
                                        { $eq: ["$status", "paid"] }, 
                                        { $gte: ["$paidAt", startOfMonth] }
                                    ] 
                                }, 
                                { $divide: ["$value", 100] }, 
                                0
                            ] 
                        }
                    },
                    
                    totalPendingGeneral: { 
                        $sum: { $cond: [{ $eq: ["$status", "pending"] }, { $divide: ["$value", 100] }, 0] } 
                    }
                }
            }
        ]);

        const result = metrics[0] || {};
        
        const uniqueOverdueStudents = result.countOverdueStudents 
            ? result.countOverdueStudents.filter(id => id !== null).length 
            : 0;
        
        const totalPortfolio = (result.totalPendingGeneral || 0) + (result.balanceMonth || 0);
        const taxa = (result.totalOverdueValue > 0 && totalPortfolio > 0) 
            ? ((result.totalOverdueValue / totalPortfolio) * 100).toFixed(1) 
            : "0.0";

        return {
            totalInadimplente: result.totalOverdueValue || 0,
            totalAVencer: result.totalFutureValue || 0,
            qtdAlunosInadimplentes: uniqueOverdueStudents,
            saldoDia: result.balanceDay || 0,
            saldoMes: result.balanceMonth || 0,
            inadimplenciaTaxa: taxa,

            // Retornando os valores corrigidos
            boletoRecebido: result.boletoPaid || 0,
            boletoAVencer: 0, // Simplificando para focar no recebido, ou implemente a mesma lógica do paid mudando status para pending
            boletoVencido: 0,

            pixRecebido: result.pixPaid || 0,
            pixAVencer: 0,
            pixVencido: 0
        };
    }

    // --- INTELIGÊNCIA DE NEGÓCIO (PERFORMANCE MENSAL) ---
    async _getMonthlyPerformance(schoolId, year) {
        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59);

        const performance = await Invoice.aggregate([
            { 
                $match: { 
                    school_id: schoolId, 
                    dueDate: { $gte: startOfYear, $lte: endOfYear }, // Filtra por COMPETÊNCIA (Vencimento)
                    status: { $ne: 'canceled' }
                } 
            },
            {
                $group: {
                    _id: { month: { $month: "$dueDate" } },
                    
                    // Receita Esperada (Total faturado no mês)
                    totalExpected: { $sum: { $divide: ["$value", 100] } },
                    
                    // Receita Realizada (Total pago referente àquele mês)
                    totalPaid: { 
                        $sum: { 
                            $cond: [{ $eq: ["$status", "paid"] }, { $divide: ["$value", 100] }, 0] 
                        } 
                    },
                    
                    // Inadimplência daquele mês específico
                    totalOverdue: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$status", "pending"] }, { $lt: ["$dueDate", new Date()] }] },
                                { $divide: ["$value", 100] },
                                0
                            ]
                        }
                    },

                    // Quantidade de Alunos distintos cobrados no mês (Proxy para Alunos Ativos)
                    uniqueStudents: { $addToSet: "$student" }
                }
            },
            { $sort: { "_id.month": 1 } }
        ]);

        return performance.map(item => {
            const studentCount = item.uniqueStudents ? item.uniqueStudents.length : 0;
            const collectionRate = item.totalExpected > 0 
                ? ((item.totalPaid / item.totalExpected) * 100).toFixed(1) 
                : 0;

            return {
                month: item._id.month,
                monthName: this._getMonthName(item._id.month),
                studentCount: studentCount, 
                financial: {
                    expected: item.totalExpected, 
                    paid: item.totalPaid,         
                    overdue: item.totalOverdue,   
                    collectionRate: Number(collectionRate) 
                }
            };
        });
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
                                "$amount", 0 
                            ] 
                        } 
                    },
                    totalPending: { 
                        $sum: { 
                            $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] 
                        } 
                    }
                }
            }
        ]);
        return result[0] || { totalMonth: 0, totalPending: 0 };
    }

    async _getCurrentMonthDaily(schoolId) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

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

    _getMonthName(monthIndex) {
        const months = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
        return months[monthIndex] || "";
    }
}

module.exports = new DashboardService();