const StudentService = require('../services/student.service');
const User = require('../models/user.model');
// [CORREÇÃO] 1. Importe o seu EventEmitter global
const appEmitter = require('../../loaders/eventEmitter'); // Verifique se o caminho está correto

class StudentController {
    
    async create(req, res, next) {
        try {
            // 1. Pegamos o ID do usuário (do middleware de auth)
            const creatorId = req.user.id; 

            // 2. Adicionamos o ID do criador aos dados do aluno
            const studentData = {
                ...req.body,
                creator: creatorId // Garante que o service salve quem criou
            };

            // 3. Chamamos o service para salvar o aluno
            const newStudent = await StudentService.createStudent(studentData);
            console.log('✅ SUCESSO: Aluno processado pelo service e salvo no banco.');

            // ==========================================================
            // [CORREÇÃO] INÍCIO DA LÓGICA DO WEBSOCKET (usando appEmitter)
            // ==========================================================
            
            // 4. Buscamos o nome do criador para enviar no payload
            const creatorDoc = await User.findById(creatorId);
            const creatorName = creatorDoc ? creatorDoc.fullName : 'Usuário';

            // 5. Montamos o payload EXATAMENTE como o Flutter espera
           const payload = {
                creator: {
                    id: req.user.id,
                    fullName: creatorName
                },
                
                // ✅ CORREÇÃO: Envie o objeto 'newStudent' inteiro.
                // O 'newStudent' é o documento que o StudentService retornou,
                // já formatado e pronto para o Flutter.
                student: newStudent 
            }

            // 6. Emitimos o evento de NEGÓCIO. 
            // O seu 'websocket.js' está ouvindo por 'student:created'
            appEmitter.emit('student:created', payload); 

            console.log(`📡 EVENTO EMITIDO: student:created para o aluno ${newStudent.fullName}`);
            // ==========================================================
            // [CORREÇÃO] FIM DA LÓGICA DO WEBSOCKET
            // ==========================================================

            // 7. Retornamos a resposta HTTP de sucesso
            res.status(201).json(newStudent);

        } catch (error) {
            // 8. Tratamento de erro
            console.error('❌ ERRO: Ocorreu um problema no controller ao tentar criar o aluno.');
            console.error('Mensagem do Erro:', error.message);
            next(error); 
        }
    }

    async getAll(req, res) {
        try {
            const students = await StudentService.getAllStudents();
            res.status(200).json(students);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar alunos', error: error.message });
        }
    }

    async getById(req, res) {
        try {
            const student = await StudentService.getStudentById(req.params.id);
            if (!student) {
                return res.status(404).json({ message: 'Aluno não encontrado' });
            }
            res.status(200).json(student);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar aluno', error: error.message });
        }
    }

    async update(req, res) {
        try {
            const student = await StudentService.updateStudent(req.params.id, req.body);
            if (!student) {
                return res.status(404).json({ message: 'Aluno não encontrado' });
            }
            // [SUGESTÃO] Você pode querer emitir um evento 'student:updated' aqui também
            // const payload = { ... };
            // appEmitter.emit('student:updated', payload);
            res.status(200).json(student);
        } catch (error) {
            res.status(400).json({ message: 'Erro ao atualizar aluno', error: error.message });
        }
    }

    async delete(req, res) {
        try {
            const student = await StudentService.deleteStudent(req.params.id);
            if (!student) {
                return res.status(404).json({ message: 'Aluno não encontrado' });
            }
            // [SUGESTÃO] Você pode querer emitir um evento 'student:deleted' aqui
            // appEmitter.emit('student:deleted', req.params.id);
            res.status(200).json({ message: 'Aluno deletado com sucesso' });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao deletar aluno', error: error.message });
        }
    }

    // --- FUNÇÃO CORRIGIDA ---
    async getUpcomingBirthdays(req, res) {
        try {
            // A única responsabilidade do controller é chamar o serviço
            const students = await StudentService.getUpcomingBirthdays();
            res.status(200).json(students);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar aniversariantes', error: error.message });
        }
    }
}

module.exports = new StudentController();