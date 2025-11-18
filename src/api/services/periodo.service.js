const Periodo = require('../models/periodo.model');
const AnoLetivo = require('../models/schoolyear.model'); 

class PeriodoService {
 
    async create(data, schoolId) {
        console.log('[PeriodoService.create] DADOS:', JSON.stringify(data, null, 2));

        try {
            // 1. Validação de Segurança e Existência do Ano Letivo
            // Buscamos o ano letivo garantindo que ele pertence à ESCOLA do usuário.
            const anoLetivo = await AnoLetivo.findOne({ 
                _id: data.schoolYearId, 
                school_id: schoolId 
            }); 
            
            if (!anoLetivo) {
                throw new Error('Ano Letivo não encontrado ou não pertence à sua escola.');
            }
            
            // 2. Validação de Datas
            // Mapeia as datas de entrada para objetos Date
            const start = new Date(data.startDate);
            const end = new Date(data.endDate);

            if (start < anoLetivo.startDate || end > anoLetivo.endDate) {
                 throw new Error('As datas do período devem estar dentro do intervalo do Ano Letivo.');
            }

            // 3. Prepara o objeto para salvar
            const dadosParaCriar = {
                titulo: data.titulo,
                tipo: data.tipo,
                dataInicio: start,
                dataFim: end,
                anoLetivoId: data.schoolYearId,
                school_id: schoolId // [IMPORTANTE] Salva o ID da escola
            };

            const periodo = await Periodo.create(dadosParaCriar); 
            return periodo;

        } catch (error) {
            // Trata erro de duplicidade (ex: Já existe 1º Bimestre neste ano)
            if (error.code === 11000) {
                throw new Error(`O período '${data.titulo}' já existe neste Ano Letivo.`);
            }
            throw error;
        }
    }

    async find(query, schoolId) {
        try {
            const filtroDB = {
                school_id: schoolId // Força o filtro por escola
            };

            // Mapeamento do filtro do front (schoolYearId) para o banco (anoLetivoId)
            if (query.schoolYearId) {
                filtroDB.anoLetivoId = query.schoolYearId;
            }
            
            const periodos = await Periodo.find(filtroDB).sort({ dataInicio: 1 });
            return periodos;
        } catch (error) {
            throw error;
        }
    }

    async findById(id, schoolId) {
        try {
            // Busca garantindo a escola
            const periodo = await Periodo.findOne({ _id: id, school_id: schoolId });
            if (!periodo) {
                throw new Error('Período não encontrado.');
            }
            return periodo;
        } catch (error) {
            throw error;
        }
    }

    async update(id, data, schoolId) {
        // Mapeamento dos campos que podem ser atualizados
        const dadosMapeados = {};
        if (data.titulo) dadosMapeados.titulo = data.titulo;
        if (data.tipo) dadosMapeados.tipo = data.tipo;
        if (data.startDate) dadosMapeados.dataInicio = data.startDate;
        if (data.endDate) dadosMapeados.dataFim = data.endDate;
        // Geralmente não se muda o anoLetivoId nem school_id num update simples, 
        // mas se precisar, adicione aqui com validação extra.

        try {
            const periodo = await Periodo.findOneAndUpdate(
                { _id: id, school_id: schoolId }, // Query segura
                dadosMapeados, 
                { new: true }
            );
            
            if (!periodo) {
                throw new Error('Período não encontrado para atualização.');
            }
            return periodo;
        } catch (error) {
            if (error.code === 11000) {
                 throw new Error(`Já existe um período com este nome neste Ano Letivo.`);
            }
            throw error;
        }
    }

    async delete(id, schoolId) {
        try {
            const periodo = await Periodo.findOneAndDelete({ _id: id, school_id: schoolId });
            if (!periodo) {
                throw new Error('Período não encontrado para exclusão.');
            }
            return { message: 'Período deletado com sucesso.' };
        } catch (error) {
            throw error;
        }
    }
}

module.exports = new PeriodoService();