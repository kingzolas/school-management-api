const Class = require('../models/class.model');
const Enrollment = require('../models/enrollment.model'); // Necessário para a verificação de deleção
const mongoose = require('mongoose'); // Necessário para $lookup

class ClassService {

    /**
     * Cria uma nova turma.
     */
    async createClass(classData) {
        try {
            const newClass = new Class(classData);
            await newClass.save();
            // Retorna o objeto simples, o evento de websocket vai disparar
            // A contagem de alunos é 0, o que está correto.
            return newClass;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`Turma '${classData.name}' já existe para o ano letivo ${classData.schoolYear}.`);
            }
            throw error;
        }
    }

    /**
     * [MODIFICADO] Busca todas as turmas, calculando a contagem de alunos.
     */
    async getAllClasses(filter = {}, sort = { schoolYear: -1, name: 1 }) {
        const aggregationPipeline = [];

        // --- Etapa 1: Filtro (Match) ---
        // Converte filtros de string para os tipos corretos do schema
        const matchFilter = {};
        if (filter.schoolYear) {
            matchFilter.schoolYear = parseInt(filter.schoolYear, 10);
        }
        if (filter.status) {
            matchFilter.status = filter.status;
        }
        // Adiciona $match apenas se houver filtros
        if (Object.keys(matchFilter).length > 0) {
            aggregationPipeline.push({ $match: matchFilter });
        }

        // --- Etapa 2: $lookup (Join) com Enrollments ---
        aggregationPipeline.push({
            $lookup: {
                from: 'enrollments', // Nome da coleção de matrículas
                localField: '_id', // Campo da 'Class'
                foreignField: 'class', // Campo da 'Enrollment'
                as: 'enrollments' // Nome do array temporário
            }
        });

        // --- Etapa 3: $addFields (Cálculo da Contagem) ---
        aggregationPipeline.push({
            $addFields: {
                // Filtra o array 'enrollments' para incluir apenas os com status 'Ativa'
                activeEnrollments: {
                    $filter: {
                        input: '$enrollments',
                        as: 'enrollment',
                        cond: { $eq: ['$$enrollment.status', 'Ativa'] }
                    }
                }
            }
        });

        aggregationPipeline.push({
            $addFields: {
                // Adiciona o campo studentCount com o tamanho do array filtrado
                studentCount: { $size: '$activeEnrollments' }
            }
        });

        // --- Etapa 4: $project (Limpeza) ---
        // Remove os arrays temporários grandes da resposta final
        aggregationPipeline.push({
            $project: {
                enrollments: 0, // Remove o array completo de matrículas
                activeEnrollments: 0 // Remove o array filtrado
            }
        });

        // --- Etapa 5: $sort ---
        aggregationPipeline.push({ $sort: sort });

        // Executa a agregação
        const classes = await Class.aggregate(aggregationPipeline);
        return classes;
    }

    /**
     * Busca uma turma específica pelo ID (pode ser necessário popular aqui se houver detalhes)
     */
    async getClassById(id) {
        // Para esta rota, podemos fazer o cálculo de contagem separado se necessário
        const classDoc = await Class.findById(id);
        if (!classDoc) {
            throw new Error(`Turma com ID ${id} não encontrada.`);
        }
        // Se a tela de "detalhes" da turma também precisar da contagem:
        const studentCount = await Enrollment.countDocuments({ class: id, status: 'Ativa' });
        
        // Adiciona a contagem ao objeto antes de retornar
        // Retornamos como um objeto JS simples para poder adicionar o campo
        const classObject = classDoc.toObject();
        classObject.studentCount = studentCount;
        
        return classObject;
    }

    /**
     * Atualiza os dados de uma turma.
     */
    async updateClass(id, updateData) {
        if (updateData.name || updateData.schoolYear) {
             const classDoc = await Class.findById(id); // Busca o doc atual
             const existing = await Class.findOne({
                 _id: { $ne: id },
                 name: updateData.name || classDoc.name,
                 schoolYear: updateData.schoolYear || classDoc.schoolYear
                });
             if (existing) {
                 throw new Error(`Já existe outra turma '${existing.name}' para o ano letivo ${existing.schoolYear}.`);
             }
        }

        const updatedClass = await Class.findByIdAndUpdate(id, updateData, {
            new: true, runValidators: true
        });
        if (!updatedClass) {
            throw new Error(`Turma com ID ${id} não encontrada para atualização.`);
        }
        
        // Pega a contagem de alunos para retornar o objeto completo
        const studentCount = await Enrollment.countDocuments({ class: id, status: 'Ativa' });
        const classObject = updatedClass.toObject();
        classObject.studentCount = studentCount;

        return classObject; // Retorna com a contagem
    }

    /**
     * Deleta uma turma.
     */
    async deleteClass(id) {
        // Regra de Negócio: Não deletar turma se houver *qualquer* matrícula (ativa ou não)
        const enrollments = await Enrollment.countDocuments({ class: id });
        if (enrollments > 0) {
            throw new Error('Não é possível excluir turma. Existem matrículas (ativas ou passadas) associadas a ela.');
        }

        const deletedClass = await Class.findByIdAndDelete(id);
        if (!deletedClass) {
            throw new Error(`Turma com ID ${id} não encontrada para deleção.`);
        }
        return deletedClass;
    }
}

module.exports = new ClassService();