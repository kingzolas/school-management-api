// src/api/services/class.service.js
const Class = require('../models/class.model');
const Enrollment = require('../models/enrollment.model'); 
const mongoose = require('mongoose'); 

const ACTIVE_CLASS_STATUSES = ['Planejada', 'Ativa'];
const UNIQUE_CLASS_INDEX_NAME = 'unique_active_class_by_school_year_shift_name';
const UNIQUE_CLASS_INDEX_KEY = { school_id: 1, schoolYear: 1, shift: 1, name: 1 };
const UNIQUE_CLASS_INDEX_PARTIAL_FILTER = { status: { $in: ACTIVE_CLASS_STATUSES } };
const UNIQUE_CLASS_INDEX_COLLATION = { locale: 'pt', strength: 2 };
let classUniquenessIndexPromise = null;

function resetClassUniquenessIndexCache() {
    classUniquenessIndexPromise = null;
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function sameObject(left = {}, right = {}) {
    return stableStringify(left) === stableStringify(right);
}

function indexHasCorrectKey(index) {
    return sameObject(index?.key || {}, UNIQUE_CLASS_INDEX_KEY);
}

function indexHasCorrectPartialFilter(index) {
    return sameObject(index?.partialFilterExpression || {}, UNIQUE_CLASS_INDEX_PARTIAL_FILTER);
}

function indexHasCorrectCollation(index) {
    const collation = index?.collation || {};
    return collation.locale === UNIQUE_CLASS_INDEX_COLLATION.locale &&
        collation.strength === UNIQUE_CLASS_INDEX_COLLATION.strength;
}

function isCorrectClassUniquenessIndex(index) {
    return index?.unique === true &&
        indexHasCorrectKey(index) &&
        indexHasCorrectPartialFilter(index) &&
        indexHasCorrectCollation(index);
}

function isClassUniquenessCandidate(index) {
    const key = index?.key || {};
    return index?.unique === true && key.name === 1 && key.schoolYear === 1;
}

function isLegacyOrIncorrectClassUniquenessIndex(index) {
    return isClassUniquenessCandidate(index) && !isCorrectClassUniquenessIndex(index);
}

function getDuplicateIndexName(error) {
    if (error?.index) return error.index;

    const message = error?.message || error?.errmsg || '';
    const match = message.match(/index:\s+([^\s]+)/i);
    return match ? match[1] : null;
}

function classifyClassDuplicateKeyError(error) {
    const keyPattern = error?.keyPattern || {};
    const indexName = getDuplicateIndexName(error);

    if (sameObject(keyPattern, UNIQUE_CLASS_INDEX_KEY) || indexName === UNIQUE_CLASS_INDEX_NAME) {
        return 'correct';
    }

    if (keyPattern.name === 1 && keyPattern.schoolYear === 1) {
        return 'legacy';
    }

    return 'unknown';
}

function logDuplicateClassIndexError({ error, classData, schoolId, operation }) {
    console.error('[ClassService] Duplicate key while saving class', {
        operation,
        indexName: getDuplicateIndexName(error),
        indexKind: classifyClassDuplicateKeyError(error),
        keyPattern: error?.keyPattern || null,
        keyValue: error?.keyValue || null,
        schoolId: schoolId ? String(schoolId) : null,
        className: classData?.name,
        classShift: classData?.shift,
        schoolYear: classData?.schoolYear
    });
}

function buildUnsafeIndexConflictError() {
    const error = new Error('Não foi possível salvar a turma por conflito de índice no banco de dados. Verifique os índices da collection de turmas.');
    error.statusCode = 409;
    return error;
}

function buildDuplicateKeyClassError({ error, classData, schoolId, operation }) {
    logDuplicateClassIndexError({ error, classData, schoolId, operation });

    if (classifyClassDuplicateKeyError(error) === 'correct') {
        return buildDuplicateClassError(classData);
    }

    return buildUnsafeIndexConflictError();
}

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
            const legacyIndexes = indexes.filter(isLegacyOrIncorrectClassUniquenessIndex);

            if (legacyIndexes.length > 0) {
                console.warn('[ClassService] Indices legados/incorretos de unicidade de turmas detectados. Rode o script controlado: npm run classes:fix-indexes -- --apply', {
                    indexes: legacyIndexes.map((index) => ({
                        name: index.name,
                        key: index.key,
                        unique: index.unique,
                        partialFilterExpression: index.partialFilterExpression || null
                    }))
                });
            }

            const correctIndex = indexes.find(isCorrectClassUniquenessIndex);
            if (correctIndex) {
                return;
            }

            const sameKeyWrongIndex = indexes.find((index) =>
                indexHasCorrectKey(index) && !isCorrectClassUniquenessIndex(index)
            );
            if (sameKeyWrongIndex) {
                console.warn('[ClassService] Indice de turmas com chave correta, mas opcoes incorretas. Rode o script controlado para revisao.', {
                    name: sameKeyWrongIndex.name,
                    key: sameKeyWrongIndex.key,
                    unique: sameKeyWrongIndex.unique,
                    partialFilterExpression: sameKeyWrongIndex.partialFilterExpression || null
                });
                return;
            }

            await Class.collection.createIndex(UNIQUE_CLASS_INDEX_KEY, {
                unique: true,
                collation: UNIQUE_CLASS_INDEX_COLLATION,
                partialFilterExpression: UNIQUE_CLASS_INDEX_PARTIAL_FILTER,
                name: UNIQUE_CLASS_INDEX_NAME
            });
        })().catch((error) => {
            classUniquenessIndexPromise = null;
            throw error;
        });
    }

    return classUniquenessIndexPromise;
}

class ClassService {

    async findClassConflict({ schoolId, classData, excludeId = null }) {
        if (!schoolId) {
            throw new Error('Usuário não autenticado ou não associado a uma escola.');
        }

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
        let normalizedClassData;
        try {
            await ensureClassUniquenessIndex();

            normalizedClassData = {
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
                throw buildDuplicateKeyClassError({
                    error,
                    classData: normalizedClassData || classData,
                    schoolId,
                    operation: 'create'
                });
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
                throw buildDuplicateKeyClassError({
                    error,
                    classData: nextClassData,
                    schoolId,
                    operation: 'update'
                });
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

const classService = new ClassService();

module.exports = classService;
module.exports.ClassService = ClassService;
module.exports.ACTIVE_CLASS_STATUSES = ACTIVE_CLASS_STATUSES;
module.exports.UNIQUE_CLASS_INDEX_NAME = UNIQUE_CLASS_INDEX_NAME;
module.exports.UNIQUE_CLASS_INDEX_KEY = UNIQUE_CLASS_INDEX_KEY;
module.exports.normalizeClassNameForComparison = normalizeClassNameForComparison;
module.exports.classifyClassDuplicateKeyError = classifyClassDuplicateKeyError;
module.exports.isCorrectClassUniquenessIndex = isCorrectClassUniquenessIndex;
module.exports.isLegacyOrIncorrectClassUniquenessIndex = isLegacyOrIncorrectClassUniquenessIndex;
module.exports.resetClassUniquenessIndexCache = resetClassUniquenessIndexCache;
