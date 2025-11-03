const Periodo = require('../models/periodo.model');
const AnoLetivo = require('../models/schoolyear.model'); 

class PeriodoService {
 
 async create(data) {
  // Log 1: Mostra os dados que chegam (Ex: schoolYearId, startDate)
  console.log('[PeriodoService.create] 1. DADOS RECEBIDOS:', JSON.stringify(data, null, 2));

  try {
      // [CORREÇÃO A] Usando 'data.schoolYearId' que veio do JSON
   console.log(`[PeriodoService.create] 2. Buscando AnoLetivo com ID: ${data.schoolYearId}`);
   const anoLetivo = await AnoLetivo.findById(data.schoolYearId); 
   
   console.log('[PeriodoService.create] 3. Resultado da busca (AnoLetivo):', anoLetivo);
   
   if (!anoLetivo) {
    console.error('[PeriodoService.create] 4. ERRO: Ano Letivo não encontrado.');
    throw new Error('Ano Letivo não encontrado.');
   }
   
      // [CORREÇÃO B] Usando 'data.startDate' e 'data.endDate' para validar
   if (new Date(data.startDate) < anoLetivo.dataInicio || new Date(data.endDate) > anoLetivo.dataFim) {
    console.warn('[PeriodoService.create] 4. ERRO: As datas do período estão fora do Ano Letivo.');
        console.warn(`[PeriodoService.create] Datas Período: ${data.startDate} a ${data.endDate}`);
        console.warn(`[PeriodoService.create] Datas Ano Letivo: ${anoLetivo.dataInicio} a ${anoLetivo.dataFim}`);
    throw new Error('As datas do período devem estar dentro do Ano Letivo.');
   }

      // [CORREÇÃO C] Criando o objeto com os nomes que o Model espera
      // (Conforme o seu periodo.model.js)
      const dadosParaCriar = {
        titulo: data.titulo,
        tipo: data.tipo,
        dataInicio: data.startDate,  // Mapeando de 'startDate' para 'dataInicio'
        dataFim: data.endDate,    // Mapeando de 'endDate' para 'dataFim'
        anoLetivoId: data.schoolYearId // Mapeando de 'schoolYearId' para 'anoLetivoId'
      };

      // Usando o objeto mapeado para criar no banco
   const periodo = await Periodo.create(dadosParaCriar); 
   
      console.log('[PeriodoService.create] 5. SUCESSO: Período criado:', periodo);
   return periodo;

  } catch (error) {
   console.error(`[PeriodoService.create] 6. ERRO CAPTURADO (catch): ${error.message}`);
   throw error;
  }
 }

 // --- MÉTODO CORRIGIDO ---
 async find(query) {
    // ---- INÍCIO DOS PRINTS ----
    console.log('[PeriodoService.find] 1. Query recebida do Flutter:', query);
    // ---- FIM DOS PRINTS ----

  try {

      // [A CORREÇÃO ESTÁ AQUI]
      // Criamos um novo objeto 'filtroDB' para o Mongoose
      const filtroDB = {};

      // Se a query do Flutter tiver 'schoolYearId',
      // nós o mapeamos para 'anoLetivoId' no filtro do banco.
      if (query.schoolYearId) {
        filtroDB.anoLetivoId = query.schoolYearId;
      }
      
      // (Você pode adicionar outros mapeamentos aqui se precisar filtrar por mais coisas)
      // if (query.tipo) {
      //  filtroDB.tipo = query.tipo;
      // }

      // ---- INÍCIO DOS PRINTS ----
      console.log('[PeriodoService.find] 2. Filtro enviado ao Mongoose:', filtroDB);
      // ---- FIM DOS PRINTS ----

      // Usamos o 'filtroDB' mapeado em vez do 'query' original
   const periodos = await Periodo.find(filtroDB).sort({ dataInicio: 1 });

      // ---- INÍCIO DOS PRINTS ----
      console.log('[PeriodoService.find] 3. Períodos encontrados no banco:', periodos);
      // ---- FIM DOS PRINTS ----

   return periodos;
  } catch (error) {
      // ---- INÍCIO DOS PRINTS ----
      console.error(`[PeriodoService.find] 4. ERRO CAPTURADO (catch): ${error.message}`);
      // ---- FIM DOS PRINTS ----
   throw error;
  }
 }

 async findById(id) {
  try {
   const periodo = await Periodo.findById(id);
   if (!periodo) {
    throw new Error('Período não encontrado.');
   }
   return periodo;
  } catch (error) {
   throw error;
  }
 }

 async update(id, data) {
    // [SUGESTÃO DE MELHORIA]
    // Se o seu 'data' no update também vem do Flutter
    // você precisará fazer o mesmo mapeamento aqui:
    const dadosMapeados = {};
    if (data.titulo) dadosMapeados.titulo = data.titulo;
    if (data.tipo) dadosMapeados.tipo = data.tipo;
    if (data.startDate) dadosMapeados.dataInicio = data.startDate;
    if (data.endDate) dadosMapeados.dataFim = data.endDate;
    if (data.schoolYearId) dadosMapeados.anoLetivoId = data.schoolYearId;

  try {
   const periodo = await Periodo.findByIdAndUpdate(id, dadosMapeados, { new: true });
   if (!periodo) {
    throw new Error('Período não encontrado.');
   }
   return periodo;
  } catch (error) {
   throw error;
  }
 }

 async delete(id) {
  try {
   const periodo = await Periodo.findByIdAndDelete(id);
   if (!periodo) {
    throw new Error('Período não encontrado.');
   }
   return { message: 'Período deletado com sucesso.' };
  } catch (error) {
   throw error;
  }
 }
}

module.exports = new PeriodoService();