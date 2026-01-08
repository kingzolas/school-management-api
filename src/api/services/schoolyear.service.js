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
            const schoolYear = await SchoolYear.findOneAndDelete({ _id: id, school_id: schoolId });
            
            if (!schoolYear) {
                throw new Error('Ano Letivo não encontrado para exclusão.');
            }
            return { message: 'Ano Letivo deletado com sucesso.', deletedId: id };
        } catch (error) {
            throw error;
        }
    }

    // =========================================================================
    // NOVO MÉTODO ADICIONADO AQUI
    // =========================================================================
    
    /**
     * Encontra qual o Ano Letivo e o Bimestre (Term) ativo para uma data específica.
     * @param {string} schoolId 
     * @param {Date|string} dateInput 
     */
    async findTermByDate(schoolId, dateInput) {
        const targetDate = new Date(dateInput);

        // 1. Busca o Ano Letivo que engloba essa data
        // Nota: Ajuste 'startDate' e 'endDate' conforme estão salvos no seu banco (camelCase ou snake_case)
        // Estou assumindo camelCase (startDate/endDate) padrão do Mongoose, mas se for snake_case mude para start_date/end_date
        const schoolYear = await SchoolYear.findOne({
            school_id: schoolId,
            startDate: { $lte: targetDate },
            endDate: { $gte: targetDate },
            // active: true // Descomente se quiser garantir que só pegue anos ativos
        });

        if (!schoolYear) {
            // Fallback: Se não achar pela data exata, tenta pegar o ano corrente/ativo
            const fallbackYear = await SchoolYear.findOne({ school_id: schoolId }).sort({ year: -1 });
            
            if (!fallbackYear) throw new Error('Nenhum ano letivo encontrado para esta escola.');
            
            return {
                schoolYearId: fallbackYear._id,
                termName: fallbackYear.terms && fallbackYear.terms.length > 0 
                    ? fallbackYear.terms[0].name 
                    : 'Único'
            };
        }

        // 2. Busca o Termo (Bimestre) dentro do array 'terms'
        // Assumindo que seu Schema de SchoolYear tem um array: terms: [{ name: String, startDate: Date, endDate: Date }]
        let activeTerm = null;
        
        if (schoolYear.terms && Array.isArray(schoolYear.terms)) {
            activeTerm = schoolYear.terms.find(term => {
                const termStart = new Date(term.startDate);
                const termEnd = new Date(term.endDate);
                termEnd.setHours(23, 59, 59, 999); // Inclui o final do dia
                
                return targetDate >= termStart && targetDate <= termEnd;
            });
        }

        return {
            schoolYearId: schoolYear._id,
            termName: activeTerm ? activeTerm.name : 'Extra/Recuperação'
        };
    }
}

module.exports = new SchoolYearService();