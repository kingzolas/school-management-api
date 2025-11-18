const SchoolYear = require('../models/schoolyear.model');

class SchoolYearService {
    
    /**
     * Cria um novo ano letivo vinculado à escola.
     */
    async create(data, schoolId) {
        try {
            const schoolYear = new SchoolYear({
                ...data,
                school_id: schoolId // Força o ID da escola
            });
            await schoolYear.save();
            return schoolYear;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`O ano letivo ${data.year} já está cadastrado nesta escola.`);
            }
            throw error;
        }
    }

    /**
     * Busca anos letivos apenas da escola solicitante.
     */
    async find(query, schoolId) {
        try {
            // Força o filtro por escola
            const filter = { ...query, school_id: schoolId };
            const schoolYears = await SchoolYear.find(filter).sort({ year: -1 });
            return schoolYears;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Busca por ID garantindo que pertença à escola.
     */
    async findById(id, schoolId) {
        try {
            const schoolYear = await SchoolYear.findOne({ _id: id, school_id: schoolId });
            if (!schoolYear) {
                throw new Error('Ano Letivo não encontrado ou sem permissão.');
            }
            return schoolYear;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Atualiza verificando duplicidade dentro da escola.
     */
    async update(id, data, schoolId) {
        try {
            // Se estiver tentando mudar o ano (ex: de 2024 para 2025),
            // verifica se 2025 já não existe nessa escola.
            if (data.year) {
                const existing = await SchoolYear.findOne({ 
                    year: data.year, 
                    school_id: schoolId, 
                    _id: { $ne: id } 
                });
                if (existing) {
                    throw new Error(`O ano letivo ${data.year} já existe nesta escola.`);
                }
            }

            // Remove school_id do data para evitar que o usuário troque o registro de escola
            delete data.school_id;

            const schoolYear = await SchoolYear.findOneAndUpdate(
                { _id: id, school_id: schoolId }, 
                data, 
                { new: true, runValidators: true }
            );

            if (!schoolYear) {
                throw new Error('Ano Letivo não encontrado para atualização.');
            }
            return schoolYear;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Deleta garantindo a escola.
     */
    async delete(id, schoolId) {
        try {
            // Aqui você poderia adicionar validação se existem turmas vinculadas a esse ano antes de deletar
            
            const schoolYear = await SchoolYear.findOneAndDelete({ _id: id, school_id: schoolId });
            
            if (!schoolYear) {
                throw new Error('Ano Letivo não encontrado para exclusão.');
            }
            return { message: 'Ano Letivo deletado com sucesso.', deletedId: id };
        } catch (error) {
            throw error;
        }
    }
}

module.exports = new SchoolYearService();