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
        
        // =================================================================
        // A CORREÇÃO ESTÁ AQUI
        // =================================================================
        // O payload que será colocado DENTRO do token
        const payload = {
            // Converte os ObjectIds para Strings
            id: user._id.toString(), // <-- CORRIGIDO
            fullName: user.fullName,
            roles: user.roles,
            school_id: user.school_id.toString() // <-- CORRIGIDO
        };
        // =================================================================

        if (!JWT_SECRET) {
            console.error("ERRO CRÍTICO: JWT_SECRET não está definida nas variáveis de ambiente.");
            throw new Error('Erro interno do servidor ao gerar token.');
        }
        
        console.log(`✅ [AUTH SERVICE] Gerando token para ${user.username} com o payload:`);
        console.log(payload); // O print agora mostrará strings

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

        await user.populate('staffProfiles');

        const userObject = user.toObject();
        delete userObject.password; 

        return { user: userObject, token };
    }
}

module.exports = new AuthService();