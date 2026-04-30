// src/api/services/class.service.js
const Class = require('../models/class.model');
const Enrollment = require('../models/enrollment.model'); 
const mongoose = require('mongoose'); 

const ACTIVE_CLASS_STATUSES = ['Planejada', 'Ativa'];
const UNIQUE_CLASS_INDEX_NAME = 'unique_active_class_by_school_year_shift_name';
let classUniquenessIndexPromise = null;

function normalizeClassNameForComparison(value = '') {
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[º°]/g, 'o')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .replace(/\b(\d+)\s*o?\s*ano\b/g, '$1o ano');
}

function buildDuplicateClassError(classData, conflict) {
    const conflictName = conflict?.name || classData.name;
    const conflictShift = conflict?.shift || classData.shift;
    const conflictYear = conflict?.schoolYear || classData.schoolYear;
    const shiftText = conflictShift ? ` no turno ${conflictShift}` : '';
    const error = new Error(`Já existe uma turma ${conflictName}${shiftText} para ${conflictYear}.`);
    error.statusCode = 409;
    return error;
}

async function ensureClassUniquenessIndex() {
    if (!classUniquenessIndexPromise) {
        classUniquenessIndexPromise = (async () => {
            const indexes = await Class.collection.indexes();

            for (const index of indexes) {
                const key = index.key || {};
                const isLegacyUniqueIndex =
                    index.unique === true &&
                    key.name === 1 &&
                    key.schoolYear === 1 &&
                    key.school_id === 1 &&
                    !Object.prototype.hasOwnProperty.call(key, 'shift') &&
                    index.name !== UNIQUE_CLASS_INDEX_NAME;

                if (isLegacyUniqueIndex) {
                    await Class.collection.dropIndex(index.name);
                    console.log(`[ClassService] Índice legado de unicidade removido: ${index.name}`);
                }
            }

            await Class.collection.createIndex(
                { school_id: 1, schoolYear: 1, shift: 1, name: 1 },
                {
                    unique: true,
                    collation: { locale: 'pt', strength: 2 },
                    partialFilterExpression: {
                        status: { $in: ACTIVE_CLASS_STATUSES }
                    },
                    name: UNIQUE_CLASS_INDEX_NAME
                }
            );
        })().catch((error) => {
            classUniquenessIndexPromise = null;
            throw error;
        });
    }

    return classUniquenessIndexPromise;
}

class ClassService {

    async findClassConflict({ schoolId, classData, excludeId = null }) {
        const status = classData.status || 'Ativa';
        if (!ACTIVE_CLASS_STATUSES.includes(status)) {
            return null;
        }

        const query = {
            school_id: schoolId,
            schoolYear: Number(classData.schoolYear),
            shift: classData.shift,
            status: { $in: ACTIVE_CLASS_STATUSES }
        };

        if (excludeId) {
            query._id = { $ne: excludeId };
        }

        const sameContextClasses = await Class.find(query)
            .select('name schoolYear shift status')
            .collation({ locale: 'pt', strength: 2 });

        const normalizedName = normalizeClassNameForComparison(classData.name);
        return sameContextClasses.find((classDoc) =>
            normalizeClassNameForComparison(classDoc.name) === normalizedName
        ) || null;
    }

    /**
     * [MODIFICADO] Cria uma nova turma, vinculada à escola.
     */
    async createClass(classData, schoolId) {
        try {
            await ensureClassUniquenessIndex();

            const normalizedClassData = {
                ...classData,
                name: classData.name?.trim(),
                grade: classData.grade?.trim(),
                room: classData.room?.trim()
            };

            const conflict = await this.findClassConflict({
                schoolId,
                classData: normalizedClassData
            });
            if (conflict) {
                throw buildDuplicateClassError(normalizedClassData, conflict);
            }

            // [MODIFICADO] Adiciona o school_id aos dados
            const newClass = new Class({
                ...normalizedClassData,
                school_id: schoolId
            });
            await newClass.save();
            return newClass;
        } catch (error) {
            if (error.code === 11000) {
                throw buildDuplicateClassError(classData);
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
        await ensureClassUniquenessIndex();

        const classDoc = await Class.findOne({ _id: id, school_id: schoolId });
        if (!classDoc) {
            throw new Error(`Turma com ID ${id} não encontrada nesta escola.`);
        }

        const normalizedUpdateData = {
            ...updateData,
            ...(updateData.name !== undefined ? { name: updateData.name?.trim() } : {}),
            ...(updateData.grade !== undefined ? { grade: updateData.grade?.trim() } : {}),
            ...(updateData.room !== undefined ? { room: updateData.room?.trim() } : {})
        };

        const nextClassData = {
            ...classDoc.toObject(),
            ...normalizedUpdateData
        };

        const conflict = await this.findClassConflict({
            schoolId,
            classData: nextClassData,
            excludeId: id
        });
        if (conflict) {
            throw buildDuplicateClassError(nextClassData, conflict);
        }

        // [MODIFICADO] Atualiza usando findOneAndUpdate com school_id
        let updatedClass;
        try {
            updatedClass = await Class.findOneAndUpdate(
                { _id: id, school_id: schoolId }, // Condição
                normalizedUpdateData, // Dados
                { new: true, runValidators: true } // Opções
            );
        } catch (error) {
            if (error.code === 11000) {
                throw buildDuplicateClassError(nextClassData);
            }
            throw error;
        }

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
