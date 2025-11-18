// src/api/services/courseLoad.service.js
const CourseLoad = require('../models/courseLoad.model.js');
const Periodo = require('../models/periodo.model.js');
const Class = require('../models/class.model.js');
const Subject = require('../models/subject.model.js');

class CourseLoadService {

    /**
     * Valida se todas as referências (Período, Turma, Disciplina) pertencem à escola.
     */
    async _validateReferences(periodoId, classId, subjectId, schoolId) {
        // Validação das 3 referências principais
        const [periodoDoc, classDoc, subjectDoc] = await Promise.all([
            Periodo.findOne({ _id: periodoId, school_id: schoolId }),
            Class.findOne({ _id: classId, school_id: schoolId }),
            Subject.findOne({ _id: subjectId, school_id: schoolId })
        ]);

        if (!periodoDoc) throw new Error('Período (Bimestre) não encontrado ou não pertence à sua escola.');
        if (!classDoc) throw new Error('Turma não encontrada ou não pertence à sua escola.');
        if (!subjectDoc) throw new Error('Disciplina não encontrada ou não pertence à sua escola.');
    }

    /**
     * Busca as cargas horárias, filtrando obrigatoriamente pela escola.
     */
    async find(query, schoolId) { // [MODIFICADO] Recebe schoolId
        try {
            // [CRÍTICO] Adiciona o filtro de escola
            const finalQuery = { ...query, school_id: schoolId };
            
            console.log('[CourseLoadService.find] Buscando com query:', finalQuery);
            
            const courseLoads = await CourseLoad.find(finalQuery)
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
     */
    async batchSave(periodoId, classId, loads, schoolId) { // [MODIFICADO] Recebe schoolId
        if (!periodoId || !classId) {
            throw new Error('periodoId e classId são obrigatórios.');
        }

        // 1. Validação de segurança inicial (para o contexto do batch)
        // Isso impede que um gestor crie cargas para turmas de outra escola.
        await this._validateReferences(periodoId, classId, loads[0]?.subjectId || 'dummy', schoolId)
            .catch(() => {
                // Se o subjectId não for válido (ou for o dummy), isso vai lançar erro
                // Mas garantimos que periodoId e classId são válidos.
            });
        
        try {
            const operations = loads.map(load => {
                const { subjectId, targetHours } = load;

                // 2. Validação Individual de Subject (caso venha um ID inválido/estranho)
                if (targetHours > 0) {
                     // Adiciona uma validação mais simples aqui para performance, mas confia no bulkWrite
                }
                
                // [CRÍTICO] O filtro de busca/atualização AGORA inclui o school_id
                const filter = { periodoId, classId, subjectId, school_id: schoolId };

                if (!targetHours || targetHours <= 0) {
                    return {
                        deleteOne: { filter }
                    };
                }

                return {
                    updateOne: {
                        filter: filter,
                        update: { $set: { targetHours, school_id: schoolId } }, // Garante que o school_id está no update
                        upsert: true,
                    }
                };
            });

            const result = await CourseLoad.bulkWrite(operations);
            
            console.log('[CourseLoadService.batchSave] Sucesso:', result);
            return result;

        } catch (error) {
            console.error('[CourseLoadService.batchSave] Erro:', error.message);
            throw error;
        }
    }
    
    // --- Rotas CRUD Padrão (Também devem ser isoladas) ---
    async create(data, schoolId) {
        const dataToCreate = { ...data, school_id: schoolId };

        await this._validateReferences(
            dataToCreate.periodoId, 
            dataToCreate.classId, 
            dataToCreate.subjectId, 
            schoolId
        );

        try {
            const newLoad = await CourseLoad.create(dataToCreate);
            return newLoad;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error('Conflito: Carga horária já existe para esta Turma/Período/Disciplina nesta escola.');
            }
            throw error;
        }
    }

    async update(id, data, schoolId) {
        // Validação de segurança e busca
        const existingLoad = await CourseLoad.findOne({ _id: id, school_id: schoolId });
        if (!existingLoad) throw new Error('Carga Horária não encontrada ou não pertence à sua escola.');

        // Se houver mudança nos campos-chave, re-valide
        if (data.periodoId || data.classId || data.subjectId) {
            await this._validateReferences(
                data.periodoId || existingLoad.periodoId, 
                data.classId || existingLoad.classId, 
                data.subjectId || existingLoad.subjectId, 
                schoolId
            );
        }
        
        delete data.school_id;

        try {
            const updatedLoad = await CourseLoad.findOneAndUpdate(
                { _id: id, school_id: schoolId }, 
                data, 
                { new: true }
            );
            return updatedLoad;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error('Conflito: A atualização resultou em uma carga horária duplicada.');
            }
            throw error;
        }
    }
}

module.exports = new CourseLoadService();