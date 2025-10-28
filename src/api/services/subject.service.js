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

/**
     * [CORRIGIDO] Cria múltiplas disciplinas (em lote).
     */
    async createMultipleSubjects(subjectsData) {
        if (!Array.isArray(subjectsData) || subjectsData.length === 0) {
            throw new Error('Dados de entrada inválidos. Um array de disciplinas é esperado.');
        }

        let createdSubjects = []; // Armazena os docs criados

        try {
            // Esta linha SÓ funciona se TUDO der certo (nenhuma duplicata)
            createdSubjects = await Subject.insertMany(subjectsData, { ordered: false });
            return createdSubjects; // Retorna a lista completa

        } catch (error) {
            // Entra aqui se PELO MENOS UM falhou (ex: duplicata)
            // Este é o comportamento esperado quando 'ordered: false' encontra duplicatas
            if (error.name === 'MongoBulkWriteError' && error.code === 11000) {
                
                console.warn('Aviso de BulkWrite: Algumas disciplinas duplicadas foram ignoradas.');
                
                // [A CORREÇÃO]
                // O 'error.result' contém os IDs que FORAM inseridos, mesmo com o erro
                if (error.result && error.result.insertedIds && error.result.insertedIds.length > 0) {
                    
                    // Pega os IDs dos documentos que *foram* inseridos
                    const insertedIds = error.result.insertedIds.map(doc => doc._id);
                    
                    // Busca esses documentos no banco para retornar
                    createdSubjects = await Subject.find({ _id: { $in: insertedIds } });
                    
                    // Retorna os que foram criados com sucesso nesta execução
                    return createdSubjects; 
                } 
                
                // Se 'insertedIds' está vazio, significa que NENHUMA nova foi criada
                // (provavelmente todas já existiam, o que não é um erro fatal)
                console.log('Nenhuma disciplina nova foi inserida (provavelmente já existem).');
                return []; // Retorna um array vazio, indicando sucesso mas 0 criações.
            }
            
            // Lança outros erros (ex: validação de 'level' falhou)
            console.error("Erro não esperado no insertMany:", error);
            throw new Error(`Erro ao inserir disciplinas em lote: ${error.message}`);
        }
    }
    
}

module.exports = new SubjectService();