const mongoose = require('mongoose');
const Student = require('../models/student.model');
const Invoice = require('../models/invoice.model');
// Ajuste o import abaixo se o seu model de professor for 'User' ou 'Staff'
const Staff = require('../models/user.model'); // Geralmente professores estão na collection de usuários
const ClassModel = require('../models/class.model');
const Subject = require('../models/subject.model');

class DashboardService {

    async getDashboardData(schoolId) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const endOfMonth = new Date(startOfMonth);
        endOfMonth.setMonth(endOfMonth.getMonth() + 1);

        // [CORREÇÃO] Garantir que schoolId seja usado corretamente nas queries
        // Alguns drivers do Mongoose aceitam string, outros exigem ObjectId na agregação.
        const schoolObjectId = new mongoose.Types.ObjectId(schoolId);

        const [
            totalStudents,
            totalTeachers,
            totalClasses,
            totalSubjects,
            financialMetrics,
            birthdays
        ] = await Promise.all([
            // 1. Contadores (Ajustados para o padrão do seu banco)
            
            // Busca alunos 'Ativo', 'active' ou 'Active'
            Student.countDocuments({ 
                school_id: schoolId, 
                status: { $in: ['Ativo', 'active', 'Active'] } 
            }),

            // Busca professores pelo array de roles OU pelo campo role único
            Staff.countDocuments({ 
                school_id: schoolId, 
                $or: [
                    { role: 'teacher' }, 
                    { roles: { $in: ['Professor', 'Teacher', 'teacher'] } }
                ]
            }), 

            ClassModel.countDocuments({ school_id: schoolId }),
            Subject.countDocuments({ school_id: schoolId }),

            // 2. Métricas Financeiras
            this._calculateFinancials(schoolObjectId, startOfDay, endOfDay, startOfMonth, endOfMonth),

            // 3. Aniversariantes
            this._getBirthdays(schoolObjectId)
        ]);

        return {
            counts: {
                students: totalStudents,
                teachers: totalTeachers,
                classes: totalClasses,
                subjects: totalSubjects
            },
            financial: financialMetrics,
            birthdays: birthdays
        };
    }

    async _calculateFinancials(schoolId, startOfDay, endOfDay, startOfMonth, endOfMonth) {
        // Nota: Na agregação, usamos o schoolId convertido para ObjectId para garantir o match
        const metrics = await Invoice.aggregate([
            { $match: { school_id: schoolId } }, 
            {
                $group: {
                    _id: null,
                    // Inadimplência (Vencido e Pendente)
                    totalOverdueValue: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$status", "pending"] }, { $lt: ["$dueDate", new Date()] }] },
                                "$value",
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
                    // Saldo do Dia
                    balanceDay: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$status", "paid"] }, { $gte: ["$paidAt", startOfDay] }, { $lte: ["$paidAt", endOfDay] }] },
                                "$value",
                                0
                            ]
                        }
                    },
                    // Vencimentos do Dia (Qtd)
                    dueDayCount: {
                        $sum: {
                            $cond: [
                                { $and: [{ $gte: ["$dueDate", startOfDay] }, { $lte: ["$dueDate", endOfDay] }] },
                                1,
                                0
                            ]
                        }
                    },
                    // Saldo do Mês
                    balanceMonth: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$status", "paid"] }, { $gte: ["$paidAt", startOfMonth] }, { $lte: ["$paidAt", endOfMonth] }] },
                                "$value",
                                0
                            ]
                        }
                    },
                    // Total Vencimentos (Pendente futuro)
                    totalPendingValue: {
                        $sum: {
                            $cond: [{ $eq: ["$status", "pending"] }, "$value", 0]
                        }
                    }
                }
            }
        ]);

        const result = metrics[0] || {};
        
        const uniqueOverdueStudents = result.countOverdueStudents 
            ? result.countOverdueStudents.filter(id => id !== null).length 
            : 0;

        return {
            inadimplenciaValor: result.totalOverdueValue || 0,
            inadimplenciaAlunos: uniqueOverdueStudents,
            saldoDia: result.balanceDay || 0,
            vencimentosDiaQtd: result.dueDayCount || 0,
            saldoMes: result.balanceMonth || 0,
            totalVencimentosPendentes: result.totalPendingValue || 0,
            inadimplenciaTaxa: (result.totalOverdueValue > 0 && result.totalPendingValue > 0) 
                ? ((result.totalOverdueValue / (result.totalPendingValue + result.totalOverdueValue)) * 100).toFixed(1) 
                : 0
        };
    }

    async _getBirthdays(schoolId) {
        const currentMonth = new Date().getMonth() + 1; 

        return await Student.aggregate([
            { 
                $match: { 
                    school_id: schoolId,
                    // Aceita qualquer variação de ativo
                    status: { $in: ['Ativo', 'active', 'Active'] },
                    $expr: { $eq: [{ $month: "$birthDate" }, currentMonth] } 
                }
            },
            { $project: { fullName: 1, birthDate: 1, profilePicture: 1 } },
            { $sort: { birthDate: 1 } }, 
            { $limit: 5 } 
        ]);
    }
}

module.exports = new DashboardService();