const Student = require('../models/student.model');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');

class AuthStudentService {

    async login(enrollmentNumber, password) {
        console.log(`🔍 [Service] Buscando aluno matrícula: ${enrollmentNumber}`);

        // 1. Busca o aluno pela matrícula
        const student = await Student.findOne({ enrollmentNumber })
            .select('+accessCredentials.passwordHash')
            .populate('school_id', 'name logoUrl');

        if (!student) {
            console.log('❌ [Service] Aluno não encontrado no banco.');
            throw new Error('Aluno não encontrado ou matrícula incorreta.');
        }

        console.log(`✅ [Service] Aluno encontrado: ${student.fullName} (ID: ${student._id})`);

        // 2. Verifica se o aluno está ativo
        if (!student.isActive) {
            console.log('❌ [Service] Aluno inativo.');
            throw new Error('Matrícula inativa. Contate a escola.');
        }

        // ==============================================================================
        // 🧠 LÓGICA DE PRIMEIRO ACESSO (AUTO-SETUP)
        // ==============================================================================
        
        // Vamos logar o estado das credenciais para entender a lógica
        console.log('Estado das credenciais:', student.accessCredentials);

        if (!student.accessCredentials || !student.accessCredentials.passwordHash) {
            console.log('⚠️ [Service] Senha não configurada. Verificando fluxo de primeiro acesso...');
            
            const DEFAULT_PASSWORD = "123456";

            if (password === DEFAULT_PASSWORD) {
                console.log(`[AUTH] Primeiro acesso detectado para ${student.fullName}. Configurando senha...`);
                
                const salt = await bcrypt.genSalt(10);
                const newHash = await bcrypt.hash(password, salt);

                if (!student.accessCredentials) student.accessCredentials = {};
                student.accessCredentials.passwordHash = newHash;
                student.accessCredentials.firstAccess = true;
                
                await student.save();
                console.log('✅ [Service] Senha padrão configurada e salva.');
            } else {
                console.log('❌ [Service] Primeiro acesso, mas senha informada não é a padrão.');
                throw new Error('Este parece ser seu primeiro acesso. A senha padrão é 123456.');
            }

        } else {
            // ==============================================================================
            // 🔐 FLUXO NORMAL (JÁ TEM SENHA)
            // ==============================================================================
            console.log('🔐 [Service] Verificando senha hash...');
            const isMatch = await bcrypt.compare(password, student.accessCredentials.passwordHash);
            
            if (!isMatch) {
                console.log('❌ [Service] Senha incorreta (Hash mismatch).');
                throw new Error('Senha incorreta.');
            }
            console.log('✅ [Service] Senha correta.');
        }

        // 3. Gera o Token JWT
        console.log('🔑 [Service] Gerando JWT...');
        const payload = {
            id: student._id,
            role: 'student',
            school_id: student.school_id._id
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });

        // 4. Atualiza telemetria de login
        await Student.findByIdAndUpdate(student._id, {
            'accessCredentials.lastLogin': new Date(),
            'accessCredentials.firstAccess': false 
        });

        return {
            token,
            student: {
                id: student._id,
                fullName: student.fullName,
                enrollmentNumber: student.enrollmentNumber,
                profilePictureUrl: student.profilePictureUrl, // Nota: No model você usa Buffer (profilePicture.data), verifique se aqui deveria ser uma URL gerada ou base64
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