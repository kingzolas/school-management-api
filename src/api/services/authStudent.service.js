const Student = require('../models/student.model');
const bcrypt = require('bcryptjs'); // Certifique-se de ter 'npm install bcryptjs'
const jwt = require('jsonwebtoken');

class AuthStudentService {

    async login(enrollmentNumber, password) {
        // 1. Busca o aluno pela matrícula
        // O '+accessCredentials.passwordHash' é vital pois esse campo é { select: false } no model
        const student = await Student.findOne({ enrollmentNumber })
            .select('+accessCredentials.passwordHash')
            .populate('school_id', 'name logoUrl'); // Traz infos da escola para o App

        if (!student) {
            throw new Error('Aluno não encontrado ou matrícula incorreta.');
        }

        // 2. Verifica se o aluno tem credenciais configuradas
        if (!student.accessCredentials || !student.accessCredentials.passwordHash) {
            throw new Error('Acesso ainda não configurado. Entre em contato com a secretaria.');
        }

        // 3. Verifica se o aluno está ativo
        if (!student.isActive) {
            throw new Error('Matrícula inativa. Contate a escola.');
        }

        // 4. Compara a senha
        const isMatch = await bcrypt.compare(password, student.accessCredentials.passwordHash);
        if (!isMatch) {
            throw new Error('Senha incorreta.');
        }

        // 5. Gera o Token JWT
        // IMPORTANTE: Adicionamos a role 'student' para o middleware identificar depois
        const payload = {
            id: student._id,
            role: 'student',
            school_id: student.school_id._id
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' }); // Token longo para App Mobile

        // 6. Atualiza dados de último login (Telemetria básica)
        await Student.findByIdAndUpdate(student._id, {
            'accessCredentials.lastLogin': new Date(),
            'accessCredentials.firstAccess': false
        });

        // 7. Retorna os dados seguros (sem a senha)
        return {
            token,
            student: {
                id: student._id,
                fullName: student.fullName,
                enrollmentNumber: student.enrollmentNumber,
                profilePictureUrl: student.profilePictureUrl,
                school: {
                    id: student.school_id._id,
                    name: student.school_id.name
                },
                role: 'student'
            }
        };
    }
}

module.exports = new AuthStudentService();