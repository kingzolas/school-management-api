// src/api/controllers/enrollment.controller.js
const EnrollmentService = require('../services/enrollment.service');
const appEmitter = require('../../loaders/eventEmitter');

class EnrollmentController {

    async create(req, res, next) {
        try {
            const schoolId = req.user.school_id || req.user.schoolId; // [NOVO] Captura o schoolId
            
            // Note: Não precisamos do userId no service, mas podemos mantê-lo
            const enrollmentData = { ...req.body, userId: req.user.id }; 
            
            // [MODIFICADO] Passa o schoolId para o Service
            const newEnrollment = await EnrollmentService.createEnrollment(enrollmentData, schoolId);

            appEmitter.emit('enrollment:created', newEnrollment);
            
            res.status(201).json(newEnrollment);
        } catch (error) {
            console.error('❌ ERRO [EnrollmentController.create]:', error.message);
             const message = String(error.message || '').toLowerCase();
             if (
                 message.includes('nao encontrado') ||
                 message.includes('não encontrado') ||
                 message.includes('nao encontrada') ||
                 message.includes('não encontrada') ||
                 message.includes('nao pertence') ||
                 message.includes('não pertence')
             ) {
                 return res.status(404).json({ message: error.message });
             }
             if (
                 message.includes('ja possui matricula') ||
                 message.includes('já possui matrícula') ||
                 message.includes('atingiu a capacidade')
             ) {
                 return res.status(409).json({ message: error.message });
             }
             next(error);
        }
    }

    async getAll(req, res, next) {
        try {
            const schoolId = req.user.school_id || req.user.schoolId; // [NOVO] Captura o schoolId
            // [MODIFICADO] Passa o schoolId para o Service
            const enrollments = await EnrollmentService.getEnrollments(req.query, schoolId, req.user);
            res.status(200).json(enrollments);
        } catch (error) {
            console.error('❌ ERRO [EnrollmentController.getAll]:', error.message);
            if (error.statusCode) {
                return res.status(error.statusCode).json({ message: error.message });
            }
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const schoolId = req.user.school_id || req.user.schoolId; // [NOVO] Captura o schoolId
            // [MODIFICADO] Passa o schoolId para o Service
            const enrollment = await EnrollmentService.getEnrollmentById(req.params.id, schoolId, req.user);
            
            res.status(200).json(enrollment);
        } catch (error) {
             console.error(`❌ ERRO [EnrollmentController.getById ${req.params.id}]:`, error.message);
             if (error.statusCode) {
                 return res.status(error.statusCode).json({ message: error.message });
             }
             const message = String(error.message || '').toLowerCase();
             if (
                 message.includes('nao encontrada') ||
                 message.includes('não encontrada') ||
                 message.includes('nao pertence') ||
                 message.includes('não pertence')
             ) {
                 return res.status(404).json({ message: error.message });
             }
             next(error);
        }
    }

    async update(req, res, next) {
        try {
            const schoolId = req.user.school_id || req.user.schoolId; // [NOVO] Captura o schoolId
            // [MODIFICADO] Passa o schoolId para o Service
            const updatedEnrollment = await EnrollmentService.updateEnrollment(req.params.id, req.body, schoolId);
            
            appEmitter.emit('enrollment:updated', updatedEnrollment);
            
            res.status(200).json(updatedEnrollment);
        } catch (error) {
             console.error(`❌ ERRO [EnrollmentController.update ${req.params.id}]:`, error.message);
             const message = String(error.message || '').toLowerCase();
             if (
                 message.includes('nao encontrada') ||
                 message.includes('não encontrada') ||
                 message.includes('nao pertence') ||
                 message.includes('não pertence')
             ) { return res.status(404).json({ message: error.message }); }
             if (
                 message.includes('atualizacao invalida') ||
                 message.includes('atualização inválida') ||
                 message.includes('negativa')
             ) { return res.status(400).json({message: error.message }); }
             next(error);
        }
    }

    async delete(req, res, next) {
        try {
            const schoolId = req.user.school_id || req.user.schoolId; // [NOVO] Captura o schoolId
            // [MODIFICADO] Passa o schoolId para o Service
            const deletedEnrollment = await EnrollmentService.deleteEnrollment(req.params.id, schoolId);

            appEmitter.emit('enrollment:deleted', deletedEnrollment); 
            
            res.status(200).json({ message: 'Matrícula deletada com sucesso', deletedEnrollment });
        } catch (error) {
             console.error(`❌ ERRO [EnrollmentController.delete ${req.params.id}]:`, error.message);
             const message = String(error.message || '').toLowerCase();
             if (
                 message.includes('nao encontrada') ||
                 message.includes('não encontrada') ||
                 message.includes('nao pertence') ||
                 message.includes('não pertence')
             ) {
                 return res.status(404).json({ message: error.message });
             }
             next(error);
        }
    }
}

module.exports = new EnrollmentController();
