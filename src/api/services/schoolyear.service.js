const SchoolYear = require('../models/schoolyear.model');

class SchoolYearService {
    
    async create(data) {
        try {
            // [REMOVIDA] Validação de schoolId
            // if (!data.schoolId) { ... }

            const schoolYear = await SchoolYear.create(data);
            return schoolYear;
        } catch (error) {
            if (error.code === 11000) {
                // [MODIFICADO] Mensagem de erro atualizada
                throw new Error('Este ano letivo (ex: 2025) já está cadastrado.');
            }
            throw error;
        }
    }

    async find(query) {
        try {
            // [MODIFICADO] A query não precisa mais de schoolId
            const schoolYears = await SchoolYear.find(query).sort({ year: -1 });
            return schoolYears;
        } catch (error) {
            throw error;
        }
    }

    async findById(id) {
        try {
            const schoolYear = await SchoolYear.findById(id);
            if (!schoolYear) {
                throw new Error('Ano Letivo não encontrado.');
            }
            return schoolYear;
        } catch (error) {
            throw error;
        }
    }

    async update(id, data) {
        try {
            const schoolYear = await SchoolYear.findByIdAndUpdate(id, data, { new: true });
            if (!schoolYear) {
                throw new Error('Ano Letivo não encontrado.');
            }
            return schoolYear;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error('Este ano letivo (ex: 2025) já está cadastrado.');
            }
            throw error;
        }
    }

    async delete(id) {
        try {
            const schoolYear = await SchoolYear.findByIdAndDelete(id);
            if (!schoolYear) {
                throw new Error('Ano Letivo não encontrado.');
            }
            return { message: 'Ano Letivo deletado com sucesso.' };
        } catch (error) {
            throw error;
        }
    }
}

module.exports = new SchoolYearService();