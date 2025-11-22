const Student = require('../models/student.model');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');

class AuthStudentService {

    async login(enrollmentNumber, password) {
        // 1. Busca o aluno pela matrícula
        // Precisamos do '+accessCredentials.passwordHash' para verificar se existe senha
        const student = await Student.findOne({ enrollmentNumber })
            .select('+accessCredentials.passwordHash')
            .populate('school_id', 'name logoUrl');

        if (!student) {
            throw new Error('Aluno não encontrado ou matrícula incorreta.');
        }

        // 2. Verifica se o aluno está ativo
        if (!student.isActive) {
            throw new Error('Matrícula inativa. Contate a escola.');
        }

        // ==============================================================================
        // 🧠 LÓGICA DE PRIMEIRO ACESSO (AUTO-SETUP)
        // ==============================================================================
        
        // Verifica se o aluno NÃO tem senha configurada (primeira vez)
        if (!student.accessCredentials || !student.accessCredentials.passwordHash) {
            
            const DEFAULT_PASSWORD = "123456"; // <--- SENHA PADRÃO DEFINIDA AQUI

            if (password === DEFAULT_PASSWORD) {
                console.log(`[AUTH] Primeiro acesso detectado para ${student.fullName}. Configurando senha...`);
                
                // Gera o hash da senha padrão e salva
                const salt = await bcrypt.genSalt(10);
                const newHash = await bcrypt.hash(password, salt);

                if (!student.accessCredentials) student.accessCredentials = {};
                student.accessCredentials.passwordHash = newHash;
                student.accessCredentials.firstAccess = true; // Marca flag de primeiro acesso
                
                await student.save(); // Salva no banco para as próximas vezes
            } else {
                throw new Error('Este parece ser seu primeiro acesso. A senha padrão é 123456.');
            }

        } else {
            // ==============================================================================
            // 🔐 FLUXO NORMAL (JÁ TEM SENHA)
            // ==============================================================================
            const isMatch = await bcrypt.compare(password, student.accessCredentials.passwordHash);
            if (!isMatch) {
                throw new Error('Senha incorreta.');
            }
        }

        // 3. Gera o Token JWT
        const payload = {
            id: student._id,
            role: 'student',
            school_id: student.school_id._id
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });

        // 4. Atualiza telemetria de login
        await Student.findByIdAndUpdate(student._id, {
            'accessCredentials.lastLogin': new Date(),
            'accessCredentials.firstAccess': false // Remove flag após login sucesso
        });

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