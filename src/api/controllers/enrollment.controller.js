const EnrollmentService = require('../services/enrollment.service');
const appEmitter = require('../../loaders/eventEmitter');

class EnrollmentController {

    async create(req, res, next) {
        try {
            const enrollmentData = { ...req.body, userId: req.user.id };
            const newEnrollment = await EnrollmentService.createEnrollment(enrollmentData);

            appEmitter.emit('enrollment:created', newEnrollment);
            console.log(`📡 EVENTO EMITIDO: enrollment:created para aluno ${newEnrollment.student.fullName} na turma ${newEnrollment.class.name}`);

            res.status(201).json(newEnrollment);
        } catch (error) {
            console.error('❌ ERRO [EnrollmentController.create]:', error.message);
             if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
             if (error.message.includes('já possui matrícula') || error.message.includes('atingiu a capacidade')) {
                 return res.status(409).json({ message: error.message });
            }
            next(error);
        }
    }

    async getAll(req, res, next) {
        try {
            const enrollments = await EnrollmentService.getEnrollments(req.query);
            res.status(200).json(enrollments);
        } catch (error) {
            console.error('❌ ERRO [EnrollmentController.getAll]:', error.message);
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const enrollment = await EnrollmentService.getEnrollmentById(req.params.id);
            res.status(200).json(enrollment);
        } catch (error) {
             console.error(`❌ ERRO [EnrollmentController.getById ${req.params.id}]:`, error.message);
             if (error.message.includes('não encontrada')) {
                 return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const updatedEnrollment = await EnrollmentService.updateEnrollment(req.params.id, req.body);
            appEmitter.emit('enrollment:updated', updatedEnrollment);
            console.log(`📡 EVENTO EMITIDO: enrollment:updated para ID ${updatedEnrollment._id}`);
            res.status(200).json(updatedEnrollment);
        } catch (error) {
            console.error(`❌ ERRO [EnrollmentController.update ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrada')) { return res.status(404).json({ message: error.message }); }
            if (error.message.includes('Atualização inválida')) { return res.status(400).json({message: error.message }); }
            next(error);
        }
    }

    async delete(req, res, next) {
        try {
            const deletedEnrollment = await EnrollmentService.deleteEnrollment(req.params.id);

            // --- [CORREÇÃO AQUI] ---
            // Em vez de emitir { id: ... }, emitimos o documento deletado
            // O service retorna o documento que foi deletado, mas ele não está populado.
            // Para o websocket saber a turma, precisamos populá-lo ANTES de deletar
            // OU (mais fácil) apenas emitimos os IDs necessários.
            // Vamos ajustar o service.deleteEnrollment para retornar o objeto.
            
            // O service.deleteEnrollment retorna o documento deletado (não populado)
            appEmitter.emit('enrollment:deleted', deletedEnrollment); // Envia o documento inteiro
            console.log(`📡 EVENTO EMITIDO: enrollment:deleted para ID ${req.params.id} (Aluno ${deletedEnrollment.student}, Turma ${deletedEnrollment.class})`);
            // --- FIM DA CORREÇÃO ---

            res.status(200).json({ message: 'Matrícula deletada com sucesso', deletedEnrollment });
        } catch (error) {
            console.error(`❌ ERRO [EnrollmentController.delete ${req.params.id}]:`, error.message);
             if (error.message.includes('não encontrada')) {
                 return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }
}

module.exports = new EnrollmentController();