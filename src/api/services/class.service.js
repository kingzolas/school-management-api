// src/api/services/class.service.js
const Class = require('../models/class.model');
const Enrollment = require('../models/enrollment.model'); 
const mongoose = require('mongoose'); 

class ClassService {

    /**
     * [MODIFICADO] Cria uma nova turma, vinculada à escola.
     */
    async createClass(classData, schoolId) {
        try {
            // [MODIFICADO] Adiciona o school_id aos dados
            const newClass = new Class({
                ...classData,
                school_id: schoolId
            });
            await newClass.save();
            return newClass;
        } catch (error) {
            if (error.code === 11000) {
                // [MODIFICADO] Mensagem de erro mais específica
                throw new Error(`Turma '${classData.name}' já existe para o ano letivo ${classData.schoolYear} nesta escola.`);
            }
            throw error;
        }
    }

    /**
     * [MODIFICADO] Busca todas as turmas, filtradas pela escola.
     */
    async getAllClasses(filter = {}, sort = { schoolYear: -1, name: 1 }, schoolId) {
        const aggregationPipeline = [];
        const { ObjectId } = mongoose.Types;

        // --- Etapa 1: Filtro (Match) ---
        // [MODIFICADO] O filtro principal OBRIGATÓRIO é o school_id
        const matchFilter = {
            school_id: new ObjectId(schoolId)
        };

        if (filter.schoolYear) {
            matchFilter.schoolYear = parseInt(filter.schoolYear, 10);
        }
        if (filter.status) {
            matchFilter.status = filter.status;
        }
        
        aggregationPipeline.push({ $match: matchFilter });

        // --- Etapa 2: $lookup (Join) com Enrollments ---
        aggregationPipeline.push({
            $lookup: {
                from: 'enrollments', 
                let: { classId: '$_id', schoolId: '$school_id' }, // Passa variáveis
                pipeline: [
                    { 
                        // Filtra matrículas pela turma E pela escola (Segurança)
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$class', '$$classId'] },
                                    { $eq: ['$school_id', '$$schoolId'] },
                                    { $eq: ['$status', 'Ativa'] } // Filtra status aqui
                                ]
                            }
                        }
                    },
                    { $count: 'count' } // Conta os resultados
                ],
                as: 'activeEnrollments' // Nome do array temporário
            }
        });

        // --- Etapa 3: $addFields (Cálculo da Contagem) ---
        aggregationPipeline.push({
            $addFields: {
                 // Pega o primeiro (e único) resultado da contagem, ou 0 se for vazio
                studentCount: { $ifNull: [ { $first: '$activeEnrollments.count' }, 0 ] }
            }
        });

        // --- Etapa 4: $project (Limpeza) ---
        aggregationPipeline.push({
            $project: {
                activeEnrollments: 0 // Remove o array temporário
            }
        });

        // --- Etapa 5: $sort ---
        aggregationPipeline.push({ $sort: sort });

        const classes = await Class.aggregate(aggregationPipeline);
        return classes;
    }

    /**
     * [MODIFICADO] Busca uma turma por ID, garantindo que pertença à escola.
     */
    async getClassById(id, schoolId) {
        // [MODIFICADO] Filtra por _id E school_id
        const classDoc = await Class.findOne({ _id: id, school_id: schoolId });
        if (!classDoc) {
            throw new Error(`Turma com ID ${id} não encontrada nesta escola.`);
        }
        
        // [MODIFICADO] Filtra contagem por school_id
        const studentCount = await Enrollment.countDocuments({ 
            class: id, 
            status: 'Ativa', 
            school_id: schoolId 
        });
        
        const classObject = classDoc.toObject();
        classObject.studentCount = studentCount;
        
        return classObject;
    }

    /**
     * [MODIFICADO] Atualiza os dados de uma turma, garantindo que pertença à escola.
     */
    async updateClass(id, updateData, schoolId) {
        // [MODIFICADO] Checagem de unicidade agora inclui school_id
        if (updateData.name || updateData.schoolYear) {
             const classDoc = await Class.findOne({ _id: id, school_id: schoolId }); 
             if (!classDoc) {
                 throw new Error(`Turma com ID ${id} não encontrada nesta escola.`);
             }
             const existing = await Class.findOne({
                 _id: { $ne: id },
                 name: updateData.name || classDoc.name,
                 schoolYear: updateData.schoolYear || classDoc.schoolYear,
                 school_id: schoolId // Checa na mesma escola
              });
             if (existing) {
                 throw new Error(`Já existe outra turma '${existing.name}' para o ano letivo ${existing.schoolYear} nesta escola.`);
             }
        }

        // [MODIFICADO] Atualiza usando findOneAndUpdate com school_id
        const updatedClass = await Class.findOneAndUpdate(
            { _id: id, school_id: schoolId }, // Condição
            updateData, // Dados
            { new: true, runValidators: true } // Opções
        );

        if (!updatedClass) {
            throw new Error(`Turma com ID ${id} não encontrada nesta escola.`);
        }
        
        // [MODIFICADO] Filtra contagem por school_id
        const studentCount = await Enrollment.countDocuments({ class: id, status: 'Ativa', school_id: schoolId });
        const classObject = updatedClass.toObject();
        classObject.studentCount = studentCount;

        return classObject;
    }

    /**
     * [MODIFICADO] Deleta uma turma, garantindo que pertença à escola.
     */
    async deleteClass(id, schoolId) {
        // [MODIFICADO] Filtra contagem por school_id
        const enrollments = await Enrollment.countDocuments({ class: id, school_id: schoolId });
        if (enrollments > 0) {
            throw new Error('Não é possível excluir turma. Existem matrículas (ativas ou passadas) associadas a ela nesta escola.');
        }

        // [MODIFICADO] Deleta usando findOneAndDelete com school_id
        const deletedClass = await Class.findOneAndDelete({ _id: id, school_id: schoolId });
        if (!deletedClass) {
            throw new Error(`Turma com ID ${id} não encontrada nesta escola.`);
        }
        return deletedClass;
    }
}

module.exports = new ClassService();