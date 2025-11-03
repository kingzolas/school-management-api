const CargaHoraria = require('../models/cargaHoraria.model');
const Term = require('../models/periodo.model');
const Class = require('../models/class.model'); // Verifique o nome do seu model de turma

class CargaHorariaService {
    
    async create(data) {
        try {
            // [Validação] Adicione verificações se o Term, Class e Subject existem
            const term = await Term.findById(data.termId);
            if (!term) throw new Error('Período (Term) não encontrado.');
            
            // const class = await Class.findById(data.classId);
            // if (!class) throw new Error('Turma (Class) não encontrada.');
            
            const carga = await CargaHoraria.create(data);
            return carga;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error('Já existe uma carga horária definida para esta matéria, nesta turma, neste período.');
            }
            throw error;
        }
    }

    async find(query) {
        // Ex: /api/carga-horaria?classId=...&termId=...
        try {
            const cargas = await CargaHoraria.find(query)
                .populate('subjectId', 'name level') // Popula o nome da matéria
                .populate('termId', 'titulo'); // Popula o título do período
            return cargas;
        } catch (error) {
            throw error;
        }
    }
    
    async update(id, data) {
        try {
            const carga = await CargaHoraria.findByIdAndUpdate(id, data, { new: true });
            if (!carga) {
                throw new Error('Carga Horária não encontrada.');
            }
            return carga;
        } catch (error) {
            throw error;
        }
    }

    async delete(id) {
        try {
            const carga = await CargaHoraria.findByIdAndDelete(id);
            if (!carga) {
                throw new Error('Carga Horária não encontrada.');
            }
            return { message: 'Carga Horária deletada com sucesso.' };
        } catch (error) {
            throw error;
        }
    }
}

module.exports = new CargaHorariaService();