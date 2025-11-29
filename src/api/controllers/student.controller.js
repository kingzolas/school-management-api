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

// [NOVO] Helper para parsear campos que vêm como String no Multipart
const parseMultipartBody = (body) => {
    const parsed = { ...body };
    
    // Lista de campos que são Objetos ou Arrays no seu Schema
    const jsonFields = ['address', 'tutors', 'healthInfo', 'authorizedPickups', 'accessCredentials'];

    jsonFields.forEach(field => {
        if (parsed[field] && typeof parsed[field] === 'string') {
            try {
                parsed[field] = JSON.parse(parsed[field]);
            } catch (e) {
                console.error(`Erro ao fazer parse do campo ${field}:`, e.message);
                // Se falhar o parse, mantém como está ou define undefined, dependendo da sua regra
            }
        }
    });

    // Converte booleanos que vêm como string "true"/"false"
    if (parsed.isActive === 'true') parsed.isActive = true;
    if (parsed.isActive === 'false') parsed.isActive = false;

    return parsed;
};

class StudentController {

    // [NOVO] Método para servir a foto
    async getPhoto(req, res) {
        try {
            const schoolId = getSchoolId(req);
            const { id } = req.params;
            
            const photo = await StudentService.getStudentPhoto(id, schoolId);
            
            res.set('Content-Type', photo.contentType);
            res.send(photo.data);
        } catch (error) {
            if (error.message.includes('não encontrado') || error.message.includes('Foto não encontrada')) {
                 return res.status(404).json({ message: 'Foto não encontrada.' });
            }
            res.status(500).json({ message: 'Erro ao buscar foto.', error: error.message });
        }
    }

    async updateTutorRelationship(req, res) {
        try {
            const schoolId = getSchoolId(req);
            const { studentId, tutorId } = req.params;
            const { relationship } = req.body;

            if (!relationship) {
                 return res.status(400).json({ message: 'O campo "relationship" é obrigatório.' });
            }
            
            console.log(`[API] PUT /students/${studentId}/tutors/${tutorId}`);

            const { updatedLink, student } = await StudentService.updateTutorRelationship(
                studentId,
                tutorId,
                relationship,
                schoolId
            );
            
            appEmitter.emit('student:updated', student);
            
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
            const schoolId = getSchoolId(req);
            const creatorId = req.user.id; 

            console.log('--- [DEBUG API] CREATE STUDENT ---');
            
            // [MODIFICADO] Se vier arquivo (req.file), fazemos o parse dos campos JSON stringificados
            let studentData = req.file ? parseMultipartBody(req.body) : req.body;
            
            studentData = {
                ...studentData,
                creator: creatorId 
            };

            // [MODIFICADO] Passa o req.file (foto) para o service
            const newStudent = await StudentService.createStudent(studentData, schoolId, req.file);
            console.log('✅ SUCESSO: Aluno criado.');

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
            
            res.status(201).json(newStudent);

        } catch (error) {
            console.error('❌ ERRO CREATE:', error.message);
            if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            next(error); 
        }
    }

    async getAll(req, res) {
        try {
            const schoolId = getSchoolId(req);
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
            const schoolId = getSchoolId(req);
            const { id } = req.params;
            
            const student = await StudentService.getStudentById(id, schoolId);
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
            const schoolId = getSchoolId(req);
            const { id } = req.params;

            console.log(`--- [DEBUG API] UPDATE STUDENT ${id} ---`);

            // [MODIFICADO] Parse do body se houver arquivo
            const updateData = req.file ? parseMultipartBody(req.body) : req.body;

            // [MODIFICADO] Passa o arquivo para o service
            const student = await StudentService.updateStudent(id, updateData, schoolId, req.file);
            
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
            const schoolId = getSchoolId(req);
            const { id } = req.params;
            
            const student = await StudentService.deleteStudent(id, schoolId);
            
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
            const schoolId = getSchoolId(req);
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
            const schoolId = getSchoolId(req);
            const { studentId } = req.params;
            const recordData = req.body; 

            if (!recordData.gradeLevel || !recordData.schoolYear || !recordData.finalResult) {
                return res.status(400).json({ message: 'Campos obrigatórios (gradeLevel, schoolYear, finalResult) não fornecidos.' });
            }

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
            const schoolId = getSchoolId(req);
            const { studentId, recordId } = req.params;
            const updatedData = req.body;

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
            const schoolId = getSchoolId(req);
            const { studentId, recordId } = req.params;

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