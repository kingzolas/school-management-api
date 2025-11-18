// src/api/controllers/student.controller.js
const StudentService = require('../services/student.service');
const User = require('../models/user.model');
const appEmitter = require('../../loaders/eventEmitter'); 

// Helper de verificação de SchoolId
const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuário não autenticado ou não associado a uma escola.');
    }
    return req.user.school_id;
};

class StudentController {

    async updateTutorRelationship(req, res) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const { studentId, tutorId } = req.params;
            const { relationship } = req.body;

            if (!relationship) {
                 return res.status(400).json({ message: 'O campo "relationship" é obrigatório.' });
            }
            
            console.log(`[API] PUT /students/${studentId}/tutors/${tutorId}`);
            console.log(`[API] Novo relacionamento: ${relationship}`);

            // [MODIFICADO] Passa o schoolId para o service
            const updatedLink = await StudentService.updateTutorRelationship(
                studentId,
                tutorId,
                relationship,
                schoolId
            );
            
            res.status(200).json(updatedLink); 

        } catch (error) {
            console.error(`[API] Erro ao atualizar relacionamento: ${error.message}`);
            if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro interno ao atualizar relacionamento.', error: error.message });
        }
    }
 
    async create(req, res, next) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const creatorId = req.user.id; 

            // (Debug inalterado)
            console.log('--- [DEBUG API] DADOS RECEBIDOS (req.body) ---');
            console.log(JSON.stringify(req.body, null, 2));
            console.log('--- [DEBUG API] FIM DOS DADOS (req.body) ---');

            const studentData = {
                ...req.body,
                creator: creatorId 
            };

            // [MODIFICADO] Passa o schoolId para o service
            const newStudent = await StudentService.createStudent(studentData, schoolId);
            console.log('✅ SUCESSO: Aluno processado pelo service e salvo no banco.');

            // Lógica de WebSocket (inalterada)
            const creatorDoc = await User.findById(creatorId);
            const creatorName = creatorDoc ? creatorDoc.fullName : 'Usuário';

            const payload = {
                creator: {
                    id: req.user.id,
                    fullName: creatorName
                },
                student: newStudent 
            };

            appEmitter.emit('student:created', payload); 
            console.log(`📡 EVENTO EMITIDO: student:created para o aluno ${newStudent.fullName}`);
            
            res.status(201).json(newStudent);

        } catch (error) {
            console.error('❌ ERRO: Ocorreu um problema no controller ao tentar criar o aluno.');
            console.error('Mensagem do Erro:', error.message);
            console.error('Stack do Erro:', error.stack); 
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            next(error); 
        }
    }

    async getAll(req, res) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            // [MODIFICADO] Passa o schoolId para o service
            const students = await StudentService.getAllStudents(schoolId);
            res.status(200).json(students);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao buscar alunos', error: error.message });
        }
    }

    async getById(req, res) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const { id } = req.params;
            
            // [MODIFICADO] Passa o schoolId para o service
            const student = await StudentService.getStudentById(id, schoolId);
            
            // O service já trata o erro 404
            res.status(200).json(student);
            
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao buscar aluno', error: error.message });
        }
    }

    async update(req, res) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const { id } = req.params;

            // [MODIFICADO] Passa o schoolId para o service
            const student = await StudentService.updateStudent(id, req.body, schoolId);
            
            // O service já trata o erro 404
            res.status(200).json(student);

        } catch (error) {
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
             if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
            res.status(400).json({ message: 'Erro ao atualizar aluno', error: error.message });
        }
    }

    async delete(req, res) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const { id } = req.params;
            
            // [MODIFICADO] Passa o schoolId para o service
            const student = await StudentService.deleteStudent(id, schoolId);
            
            // O service já trata o erro 404
            res.status(200).json({ message: 'Aluno deletado com sucesso' });
            
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
             if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao deletar aluno', error: error.message });
        }
    }

    async getUpcomingBirthdays(req, res) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            // [MODIFICADO] Passa o schoolId para o service
            const students = await StudentService.getUpcomingBirthdays(schoolId);
            res.status(200).json(students);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao buscar aniversariantes', error: error.message });
        }
    }

    async addAcademicRecord(req, res, next) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const { studentId } = req.params;
            const recordData = req.body; 

            if (!recordData.gradeLevel || !recordData.schoolYear || !recordData.finalResult) {
                return res.status(400).json({ message: 'Campos obrigatórios (gradeLevel, schoolYear, finalResult) não fornecidos.' });
            }

            // [MODIFICADO] Passa o schoolId para o service
            const updatedStudent = await StudentService.addHistoryRecord(studentId, recordData, schoolId);
            
            res.status(201).json(updatedStudent.academicHistory); 

        } catch (error) {
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
             if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async updateAcademicRecord(req, res, next) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const { studentId, recordId } = req.params;
            const updatedData = req.body;

            // [MODIFICADO] Passa o schoolId para o service
            const updatedStudent = await StudentService.updateHistoryRecord(studentId, recordId, updatedData, schoolId);
            
            res.status(200).json(updatedStudent.academicHistory);

        } catch (error) {
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
             if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async deleteAcademicRecord(req, res, next) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const { studentId, recordId } = req.params;

            // [MODIFICADO] Passa o schoolId para o service
            const updatedStudent = await StudentService.deleteHistoryRecord(studentId, recordId, schoolId);

            res.status(200).json(updatedStudent.academicHistory);

        } catch (error) {
             if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
             if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }
}

module.exports = new StudentController();