// src/api/controllers/subject.controller.js
const SubjectService = require('../services/subject.service');
const appEmitter = require('../../loaders/eventEmitter'); 

class SubjectController {

    async create(req, res, next) {
        try {
            // Assume-se que o middleware de auth popula req.user com school_id
            const schoolId = req.user.school_id; 

            const newSubject = await SubjectService.createSubject(req.body, schoolId);
            
            appEmitter.emit('subject:created', newSubject);
            
            res.status(201).json(newSubject);
        } catch (error) {
            if (error.message.includes('já existe')) {
                return res.status(409).json({ message: error.message });
            }
            next(error); 
        }
    }

    async createBulk(req, res, next) {
        const { subjects } = req.body; 
        // Pega o school_id do usuário logado
        const schoolId = req.user.school_id;

        if (!subjects || !Array.isArray(subjects) || subjects.length === 0) {
            return res.status(400).json({ message: 'Array "subjects" inválido.' });
        }

        try {
            const createdSubjects = await SubjectService.createMultipleSubjects(subjects, schoolId);

            createdSubjects.forEach(subject => {
                appEmitter.emit('subject:created', subject);
            });

            res.status(201).json({
                message: `${createdSubjects.length} de ${subjects.length} disciplinas criadas (duplicatas ignoradas).`,
                createdSubjects
            });

        } catch (error) {
            res.status(400).json({ message: error.message }); 
        }
    }

    async getAll(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            const subjects = await SubjectService.getAllSubjects(req.query, schoolId);
            res.status(200).json(subjects);
        } catch (error) {
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            const subject = await SubjectService.getSubjectById(req.params.id, schoolId);
            res.status(200).json(subject);
        } catch (error) {
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            const updatedSubject = await SubjectService.updateSubject(req.params.id, req.body, schoolId);
            
            appEmitter.emit('subject:updated', updatedSubject);
            
            res.status(200).json(updatedSubject);
        } catch (error) {
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
            const schoolId = req.user.school_id;
            const deletedSubject = await SubjectService.deleteSubject(req.params.id, schoolId);
            
            appEmitter.emit('subject:deleted', { id: req.params.id });
            
            res.status(200).json({ message: 'Disciplina deletada com sucesso', deletedSubject });
        } catch (error) {
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('está em uso')) {
                return res.status(400).json({ message: error.message });
            }
            next(error);
        }
    }
}

module.exports = new SubjectController();