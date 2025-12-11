// src/api/services/auth.service.js
const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET; 

class AuthService {
    async login(identifier, password) {
        const user = await User.findOne({
            $or: [{ email: identifier }, { username: identifier }]
        }).select('+password'); 

        if (!user) {
            throw new Error('Credenciais inválidas.'); 
        }

        if (user.status === 'Inativo') {
             throw new Error('Esta conta de usuário está inativa.');
        }

        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            throw new Error('Credenciais inválidas.'); 
        }

        if (!user.school_id) {
            console.error(`[AUTH_FAILURE] Usuário ${user._id} tentou logar sem um school_id associado.`);
            throw new Error('Esta conta de usuário não está vinculada a nenhuma escola. Contate o suporte.');
        }
        
        const payload = {
            id: user._id.toString(),
            fullName: user.fullName,
            roles: user.roles,
            school_id: user.school_id.toString()
        };

        if (!JWT_SECRET) {
            console.error("ERRO CRÍTICO: JWT_SECRET não está definida nas variáveis de ambiente.");
            throw new Error('Erro interno do servidor ao gerar token.');
        }
        
        console.log(`✅ [AUTH SERVICE] Gerando token para ${user.username}...`);

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

        // Popula os perfis E, dentro deles, popula as disciplinas (enabledSubjects)
await user.populate({
    path: 'staffProfiles',
    populate: { 
        path: 'enabledSubjects',
        model: 'Subject' // Garante que busca na collection correta
    }
});

        const userObject = user.toObject();
        delete userObject.password; 

        // =================================================================
        // [DEBUG] IDENTIFICAR TIPO DO ADDRESS
        // =================================================================
        console.log('--- [DEBUG BACKEND] DADOS DE RETORNO ---');
        console.log(`User ID: ${userObject._id}`);
        
        // Verifica o Address
        if (userObject.address) {
            console.log('Address TYPE:', typeof userObject.address);
            console.log('Address VALUE:', userObject.address);
        } else {
            console.log('Address: NULL ou UNDEFINED');
        }

        // Verifica o HealthInfo (se existir no seu user model)
        if (userObject.healthInfo) {
             console.log('HealthInfo TYPE:', typeof userObject.healthInfo);
        }
        console.log('----------------------------------------');
        // =================================================================

        return { user: userObject, token };
    }
}

module.exports = new AuthService();