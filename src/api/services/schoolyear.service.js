const SchoolYear = require('../models/schoolyear.model');

class SchoolYearService {
    
    /**
     * Cria um novo ano letivo vinculado à escola.
     */
    async create(data, schoolId) {
        try {
            console.log(`[SchoolYearService] Tentando criar ano ${data.year} para school_id: ${schoolId}`);

            // Verificação manual para evitar duplicidade antes de bater no banco
            const existing = await SchoolYear.findOne({ 
                year: data.year, 
                school_id: schoolId 
            });

            if (existing) {
                throw new Error(`O ano letivo ${data.year} já está cadastrado nesta escola.`);
            }

            const schoolYear = new SchoolYear({
                ...data,
                school_id: schoolId // Nome exato conforme seu schoolyear.model.js
            });

            // Se o seu banco insistir no erro de 'schoolId' (sem underline),
            // esta linha garante que o campo fantasma não seja enviado como null
            schoolYear.set('schoolId', undefined); 

            await schoolYear.save();
            return schoolYear;
        } catch (error) {
            console.error(`[SchoolYearService] Erro ao criar:`, error);
            if (error.code === 11000) {
                // Se cair aqui, é porque o índice antigo 'year_1_schoolId_1' ainda existe no banco
                throw new Error(`Erro de duplicidade: O ano ${data.year} conflita com um registro existente ou índice antigo.`);
            }
            throw error;
        }
    }

    /**
     * Busca anos letivos apenas da escola solicitante.
     */
    async find(query, schoolId) {
        try {
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

    /**
     * Encontra qual o Ano Letivo e o Bimestre (Term) ativo para uma data específica.
     */
    async findTermByDate(schoolId, dateInput) {
        const targetDate = new Date(dateInput);

        const schoolYear = await SchoolYear.findOne({
            school_id: schoolId,
            startDate: { $lte: targetDate },
            endDate: { $gte: targetDate },
        });

        if (!schoolYear) {
            const fallbackYear = await SchoolYear.findOne({ school_id: schoolId }).sort({ year: -1 });
            if (!fallbackYear) throw new Error('Nenhum ano letivo encontrado para esta escola.');
            
            return {
                schoolYearId: fallbackYear._id,
                termName: fallbackYear.terms?.length > 0 ? fallbackYear.terms[0].name : 'Único'
            };
        }

        let activeTerm = null;
        if (schoolYear.terms && Array.isArray(schoolYear.terms)) {
            activeTerm = schoolYear.terms.find(term => {
                const termStart = new Date(term.startDate);
                const termEnd = new Date(term.endDate);
                termEnd.setHours(23, 59, 59, 999);
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