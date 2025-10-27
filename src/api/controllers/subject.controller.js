const SubjectService = require('../services/subject.service');
const appEmitter = require('../../loaders/eventEmitter'); // Seu emissor global

class SubjectController {

    async create(req, res, next) {
        try {
            const newSubject = await SubjectService.createSubject(req.body);
            
            // Emite o evento APÓS salvar com sucesso
            appEmitter.emit('subject:created', newSubject);
            console.log(`📡 EVENTO EMITIDO: subject:created para ${newSubject.name}`);
            
            res.status(201).json(newSubject);
        } catch (error) {
            console.error('❌ ERRO [SubjectController.create]:', error.message);
            // Trata erro de duplicata vindo do service
            if (error.message.includes('já existe')) {
                return res.status(409).json({ message: error.message }); // 409 Conflict
            }
            // Passa para o middleware de erro
            next(error); 
        }
    }

    async getAll(req, res, next) {
        try {
            // Permite filtrar por query, ex: /api/subjects?level=Ensino Médio
            const subjects = await SubjectService.getAllSubjects(req.query);
            res.status(200).json(subjects);
        } catch (error) {
            console.error('❌ ERRO [SubjectController.getAll]:', error.message);
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const subject = await SubjectService.getSubjectById(req.params.id);
            res.status(200).json(subject);
        } catch (error) {
            console.error(`❌ ERRO [SubjectController.getById ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const updatedSubject = await SubjectService.updateSubject(req.params.id, req.body);
            
            appEmitter.emit('subject:updated', updatedSubject);
            console.log(`📡 EVENTO EMITIDO: subject:updated para ${updatedSubject.name}`);
            
            res.status(200).json(updatedSubject);
        } catch (error) {
            console.error(`❌ ERRO [SubjectController.update ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('já existe')) {
                return res.status(409).json({ message: error.message });
            }
            next(error);
        }
    }

    async delete(req, res, next) {
        try {
            const deletedSubject = await SubjectService.deleteSubject(req.params.id);
            
            appEmitter.emit('subject:deleted', { id: req.params.id }); // Emite o ID
            console.log(`📡 EVENTO EMITIDO: subject:deleted para ID ${req.params.id}`);
            
            res.status(200).json({ message: 'Disciplina deletada com sucesso', deletedSubject });
        } catch (error) {
            console.error(`❌ ERRO [SubjectController.delete ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            // Erro de "em uso" vindo do service
            if (error.message.includes('está em uso')) {
                return res.status(400).json({ message: error.message }); // 400 Bad Request
            }
            next(error);
        }
    }
}

module.exports = new SubjectController();