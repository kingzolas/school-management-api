// src/api/controllers/class.controller.js
const ClassService = require('../services/class.service');
const appEmitter = require('../../loaders/eventEmitter');

// Helper de verificação de SchoolId
const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuário não autenticado ou não associado a uma escola.');
    }
    return req.user.school_id;
};

class ClassController {

    async create(req, res, next) {
        try {
            // [MODIFICADO] Pega o schoolId e passa para o service
            const schoolId = getSchoolId(req);
            const newClass = await ClassService.createClass(req.body, schoolId);
            
            appEmitter.emit('class:created', newClass);
            console.log(`📡 EVENTO EMITIDO: class:created para a turma ${newClass.name} (${newClass.schoolYear})`);
            res.status(201).json(newClass);
        } catch (error) {
            if (error.statusCode) {
                 return res.status(error.statusCode).json({ message: error.message });
            }
            console.error('❌ ERRO [ClassController.create]:', error.message);
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('já existe')) {
                 return res.status(409).json({ message: error.message });
            }
            next(error); 
        }
    }

    async getAll(req, res, next) {
        try {
            // [MODIFICADO] Pega o schoolId e passa para o service
            const schoolId = getSchoolId(req);
            const classes = await ClassService.getAllClasses(req.query, undefined, schoolId);
            res.status(200).json(classes);
        } catch (error) {
            console.error('❌ ERRO [ClassController.getAll]:', error.message);
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            // [MODIFICADO] Pega o schoolId e passa para o service
            const schoolId = getSchoolId(req);
            const classDoc = await ClassService.getClassById(req.params.id, schoolId);
            res.status(200).json(classDoc);
        } catch (error) {
            console.error(`❌ ERRO [ClassController.getById ${req.params.id}]:`, error.message);
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrada')) {
                 return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            // [MODIFICADO] Pega o schoolId e passa para o service
            const schoolId = getSchoolId(req);
            const updatedClass = await ClassService.updateClass(req.params.id, req.body, schoolId);
            
            appEmitter.emit('class:updated', updatedClass);
            console.log(`📡 EVENTO EMITIDO: class:updated para a turma ${updatedClass.name} (${updatedClass.schoolYear})`);
            res.status(200).json(updatedClass);
        } catch (error) {
            if (error.statusCode) {
                 return res.status(error.statusCode).json({ message: error.message });
            }
            console.error(`❌ ERRO [ClassController.update ${req.params.id}]:`, error.message);
             if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrada')) {
                 return res.status(404).json({ message: error.message });
            }
             if (error.message.includes('Já existe outra turma')) {
                 return res.status(409).json({ message: error.message });
            }
            next(error);
        }
    }

    async delete(req, res, next) {
        try {
            // [MODIFICADO] Pega o schoolId e passa para o service
            const schoolId = getSchoolId(req);
            const deletedClass = await ClassService.deleteClass(req.params.id, schoolId);
            
            appEmitter.emit('class:deleted', { id: req.params.id });
            console.log(`📡 EVENTO EMITIDO: class:deleted para o ID ${req.params.id}`);
            res.status(200).json({ message: 'Turma deletada com sucesso', deletedClass });
        } catch (error) {
            console.error(`❌ ERRO [ClassController.delete ${req.params.id}]:`, error.message);
             if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrada')) {
                 return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('Existem matrículas')) {
                 return res.status(409).json({ message: error.message }); // 409 Conflict
            }
            next(error);
        }
    }
}

module.exports = new ClassController();
