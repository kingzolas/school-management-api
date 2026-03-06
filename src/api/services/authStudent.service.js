const Student = require('../models/student.model');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');

// [ADICIONADO] Precisamos importar o serviço de tokens aqui para o Magic Link
const tempAccessTokenService = require('../services/tempAccessToken.service');

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
        if (student.isActive === false || student.status === 'Inativo') {
            console.log('❌ [Service] Aluno inativo.');
            throw new Error('Matrícula inativa. Contate a escola.');
        }

        // ==============================================================================
        // 🧠 LÓGICA DE PRIMEIRO ACESSO (AUTO-SETUP)
        // ==============================================================================
        console.log('Estado das credenciais:', student.accessCredentials);

        if (!student.accessCredentials || !student.accessCredentials.passwordHash) {
            console.log('⚠️ [Service] Senha não configurada. Verificando fluxo de primeiro acesso...');
            
            const DEFAULT_PASSWORD = "123456";

            if (password === DEFAULT_PASSWORD) {
                console.log(`[AUTH] Primeiro acesso detectado para ${student.fullName}. Configurando senha...`);
                
                const salt = await bcrypt.genSalt(10);
                const newHash = await bcrypt.hash(password, salt);

                if (!student.accessCredentials) {
                    student.accessCredentials = {};
                }
                
                student.accessCredentials.passwordHash = newHash;
                student.accessCredentials.firstAccess = true;
                
                student.markModified('accessCredentials');
                
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
                profilePictureUrl: student.profilePictureUrl, 
                school: {
                    id: student.school_id._id,
                    name: student.school_id.name
                },
                role: 'student'
            }
        };
    }

    // ==============================================================================
    // 🔗 LÓGICA DE ACESSO VIA MAGIC LINK (WHATSAPP)
    // ==============================================================================
    async loginWithMagicLink(magicToken) {
    console.log(`🔗 [Service] Processando Magic Link para token: ${magicToken}`);

    const tokenData = await tempAccessTokenService.consumeStudentPortalToken(magicToken);

    if (!tokenData || !tokenData.authToken || !tokenData.student) {
        throw new Error('Link expirado ou já utilizado. Solicite um novo acesso.');
    }

    console.log(`✅ [Service] Aluno autenticado via Magic Link: ${tokenData.student.fullName}`);

    return {
        token: tokenData.authToken,
        student: tokenData.student
    };
}
}

module.exports = new AuthStudentService();