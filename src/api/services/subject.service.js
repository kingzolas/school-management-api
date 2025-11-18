// src/api/services/subject.service.js
const Subject = require('../models/subject.model');
const StaffProfile = require('../models/staffProfile.model');

class SubjectService {

    /**
     * Cria uma nova disciplina vinculada a uma escola.
     */
    async createSubject(subjectData, schoolId) {
        try {
            const newSubject = new Subject({
                ...subjectData,
                school_id: schoolId // Força o ID da escola
            });
            await newSubject.save();
            return newSubject;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`A disciplina '${subjectData.name}' já existe nesta escola.`);
            }
            throw error;
        }
    }

    /**
     * Busca todas as disciplinas de uma escola específica com filtros opcionais.
     */
    async getAllSubjects(filter = {}, schoolId) {
        // Garante que só busque dados da escola do usuário
        const query = { ...filter, school_id: schoolId };
        return await Subject.find(query).sort({ level: 1, name: 1 });
    }

    /**
     * Busca uma disciplina por ID e Escola (segurança extra).
     */
    async getSubjectById(id, schoolId) {
        const subject = await Subject.findOne({ _id: id, school_id: schoolId });
        
        if (!subject) {
            throw new Error('Disciplina não encontrada ou você não tem permissão para acessá-la.');
        }
        return subject;
    }

    /**
     * Atualiza uma disciplina.
     */
    async updateSubject(id, updateData, schoolId) {
        // Verificação de duplicidade manual para update (scopada por escola)
        if (updateData.name) {
            const existing = await Subject.findOne({ 
                name: updateData.name, 
                school_id: schoolId, 
                _id: { $ne: id } 
            });
            if (existing) {
                throw new Error(`A disciplina '${updateData.name}' já existe nesta escola.`);
            }
        }
        
        // Impede que o usuário mude a disciplina de escola via update
        delete updateData.school_id; 

        const updatedSubject = await Subject.findOneAndUpdate(
            { _id: id, school_id: schoolId }, // Query de segurança
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedSubject) {
            throw new Error('Disciplina não encontrada para atualizar.');
        }
        return updatedSubject;
    }

    /**
     * Deleta uma disciplina.
     */
    async deleteSubject(id, schoolId) {
        // 1. Verifica se a disciplina existe e pertence à escola
        const subject = await Subject.findOne({ _id: id, school_id: schoolId });
        if (!subject) {
            throw new Error('Disciplina não encontrada para deletar.');
        }

        // 2. Regra de Negócio: Verifica uso em StaffProfile
        // Nota: StaffProfile também deve ter school_id, mas o ID da disciplina já é único globalmente.
        const usageCount = await StaffProfile.countDocuments({ enabledSubjects: id });

        if (usageCount > 0) {
            throw new Error(`Não é possível excluir. Esta disciplina está habilitada para ${usageCount} funcionário(s).`);
        }

        await Subject.findByIdAndDelete(id);
        return subject;
    }

    /**
     * Cria múltiplas disciplinas (em lote) para uma escola específica.
     */
    async createMultipleSubjects(subjectsData, schoolId) {
        if (!Array.isArray(subjectsData) || subjectsData.length === 0) {
            throw new Error('Dados de entrada inválidos.');
        }

        // Injeta o school_id em todos os objetos do array
        const subjectsWithSchool = subjectsData.map(sub => ({
            ...sub,
            school_id: schoolId
        }));

        let createdSubjects = [];

        try {
            createdSubjects = await Subject.insertMany(subjectsWithSchool, { ordered: false });
            return createdSubjects;

        } catch (error) {
            if (error.name === 'MongoBulkWriteError' && error.code === 11000) {
                console.warn('Aviso de BulkWrite: Duplicatas ignoradas para esta escola.');
                
                if (error.result && error.result.insertedIds && error.result.insertedIds.length > 0) {
                    const insertedIds = error.result.insertedIds.map(doc => doc._id);
                    createdSubjects = await Subject.find({ _id: { $in: insertedIds } });
                    return createdSubjects; 
                } 
                
                return []; 
            }
            
            console.error("Erro no insertMany:", error);
            throw new Error(`Erro ao inserir disciplinas: ${error.message}`);
        }
    }
}

module.exports = new SubjectService();