const Subject = require('../models/subject.model');
const StaffProfile = require('../models/staffProfile.model'); // Importa o StaffProfile para checagem

class SubjectService {

    /**
     * Cria uma nova disciplina.
     */
    async createSubject(subjectData) {
        try {
            const newSubject = new Subject(subjectData);
            await newSubject.save();
            return newSubject;
        } catch (error) {
            // Trata o erro de "nome duplicado" (índice unique)
            if (error.code === 11000) {
                throw new Error(`A disciplina '${subjectData.name}' já existe.`);
            }
            // Re-lança outros erros de validação
            throw error;
        }
    }

    /**
     * Busca todas as disciplinas, permitindo filtros (ex: por 'level').
     */
    async getAllSubjects(filter = {}) {
        // Ordena por nível e depois por nome
        return await Subject.find(filter).sort({ level: 1, name: 1 });
    }

    /**
     * Busca uma disciplina por ID.
     */
    async getSubjectById(id) {
        const subject = await Subject.findById(id);
        if (!subject) {
            throw new Error('Disciplina não encontrada.');
        }
        return subject;
    }

    /**
     * Atualiza uma disciplina.
     */
    async updateSubject(id, updateData) {
        // Se o nome está sendo atualizado, checa se ele já existe em outro doc
        if (updateData.name) {
            try {
                const existing = await Subject.findOne({ name: updateData.name, _id: { $ne: id } });
                if (existing) {
                    throw new Error(`A disciplina '${updateData.name}' já existe.`);
                }
            } catch (error) {
                throw new Error(error.message);
            }
        }
        
        const updatedSubject = await Subject.findByIdAndUpdate(id, updateData, {
            new: true, // Retorna o documento atualizado
            runValidators: true // Roda os validadores (enum, required)
        });

        if (!updatedSubject) {
            throw new Error('Disciplina não encontrada para atualizar.');
        }
        return updatedSubject;
    }

    /**
     * Deleta uma disciplina.
     */
    async deleteSubject(id) {
        // --- Regra de Negócio Crítica ---
        // Verifica se alguma 'StaffProfile' (professor) está usando esta disciplina
        const usageCount = await StaffProfile.countDocuments({ enabledSubjects: id });

        if (usageCount > 0) {
            throw new Error(`Não é possível excluir. Esta disciplina está habilitada para ${usageCount} funcionário(s).`);
        }
        // --- Fim da Verificação ---

        const deletedSubject = await Subject.findByIdAndDelete(id);
        if (!deletedSubject) {
            throw new Error('Disciplina não encontrada para deletar.');
        }
        return deletedSubject;
    }
}

module.exports = new SubjectService();