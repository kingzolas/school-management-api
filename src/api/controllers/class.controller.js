const ClassService = require('../services/class.service');
const appEmitter = require('../../loaders/eventEmitter'); // Seu emissor global

class ClassController {

    async create(req, res, next) {
        try {
            const newClass = await ClassService.createClass(req.body);
            // Emite o evento APÓS salvar com sucesso
            appEmitter.emit('class:created', newClass);
            console.log(`📡 EVENTO EMITIDO: class:created para a turma ${newClass.name} (${newClass.schoolYear})`);
            res.status(201).json(newClass);
        } catch (error) {
            console.error('❌ ERRO [ClassController.create]:', error.message);
            next(error); // Passa para o middleware de erro
        }
    }

    async getAll(req, res, next) {
        try {
            // Passa req.query para permitir filtros como /api/classes?schoolYear=2025
            const classes = await ClassService.getAllClasses(req.query);
            res.status(200).json(classes);
        } catch (error) {
            console.error('❌ ERRO [ClassController.getAll]:', error.message);
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const classDoc = await ClassService.getClassById(req.params.id);
            res.status(200).json(classDoc);
        } catch (error) {
            console.error(`❌ ERRO [ClassController.getById ${req.params.id}]:`, error.message);
             // Trata erro "Não encontrado" especificamente
            if (error.message.includes('não encontrada')) {
                 return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const updatedClass = await ClassService.updateClass(req.params.id, req.body);
            appEmitter.emit('class:updated', updatedClass);
            console.log(`📡 EVENTO EMITIDO: class:updated para a turma ${updatedClass.name} (${updatedClass.schoolYear})`);
            res.status(200).json(updatedClass);
        } catch (error) {
            console.error(`❌ ERRO [ClassController.update ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrada')) {
                 return res.status(404).json({ message: error.message });
            }
             if (error.message.includes('Já existe outra turma')) {
                 return res.status(409).json({ message: error.message }); // 409 Conflict
            }
            next(error);
        }
    }

    async delete(req, res, next) {
        try {
            const deletedClass = await ClassService.deleteClass(req.params.id);
            // Emite o ID da turma deletada
            appEmitter.emit('class:deleted', { id: req.params.id });
            console.log(`📡 EVENTO EMITIDO: class:deleted para o ID ${req.params.id}`);
            res.status(200).json({ message: 'Turma deletada com sucesso', deletedClass }); // Ou res.status(204).send();
        } catch (error) {
            console.error(`❌ ERRO [ClassController.delete ${req.params.id}]:`, error.message);
             if (error.message.includes('não encontrada')) {
                 return res.status(404).json({ message: error.message });
            }
            // Adicionar tratamento para erro de "matrículas ativas" se implementar a regra
            next(error);
        }
    }
}

module.exports = new ClassController();