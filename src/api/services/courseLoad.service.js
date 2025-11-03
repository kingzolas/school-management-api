const CourseLoad = require('../models/courseLoad.model.js');
// [REMOVIDO] Não precisamos mais do mongoose aqui se não usarmos transações
// const mongoose = require('mongoose'); 

class CourseLoadService {

 /**
 * Busca as cargas horárias.
 */
 async find(query) {
  try {
   console.log('[CourseLoadService.find] Buscando com query:', query);
   
      // Esta linha (populate) é a que causava o erro 500 no GET.
      // A correção no courseLoad.model.js deve resolver.
   const courseLoads = await CourseLoad.find(query)
    .populate('subjectId', 'name color'); 

   console.log(`[CourseLoadService.find] ${courseLoads.length} cargas encontradas.`);
   return courseLoads;
  } catch (error) {
   console.error('[CourseLoadService.find] Erro:', error.message);
   throw error;
  }
 }

 /**
 * Salva em lote (Cria ou Atualiza) a matriz curricular.
   * [CORRIGIDO] Lógica de transação removida para maior compatibilidade.
 */
 async batchSave(periodoId, classId, loads) {
  if (!periodoId || !classId) {
   throw new Error('periodoId e classId são obrigatórios.');
  }

  try {
   const operations = loads.map(load => {
    const { subjectId, targetHours } = load;

        // Se targetHours for 0 ou nulo, removemos a meta
        if (!targetHours || targetHours <= 0) {
          return {
            deleteOne: {
              filter: { periodoId, classId, subjectId }
            }
          };
        }

        // 'upsert: true' -> Atualiza se existir, Cria se não existir.
    return {
     updateOne: {
      filter: { periodoId, classId, subjectId },
      update: { $set: { targetHours } },
      upsert: true,
     }
    };
   });

      // [CORRIGIDO] Chamada direta ao bulkWrite, sem sessão.
   const result = await CourseLoad.bulkWrite(operations);
   
   console.log('[CourseLoadService.batchSave] Sucesso:', result);
   return result;

  } catch (error) {
   // Este log agora deve mostrar o erro real do bulkWrite, se houver.
   console.error('[CourseLoadService.batchSave] Erro:', error.message);
   throw error;
  }
 }
 
 // ... (demais métodos: create, update) ...
 async create(data) {
  try {
   const newLoad = await CourseLoad.create(data);
   return newLoad;
  } catch (error) {
   throw error;
  }
 }

 async update(id, data) {
  try {
   const updatedLoad = await CourseLoad.findByIdAndUpdate(id, data, { new: true });
   if (!updatedLoad) throw new Error('Carga Horária não encontrada.');
   return updatedLoad;
  } catch (error) {
   throw error;
  }
 }
}

module.exports = new CourseLoadService();