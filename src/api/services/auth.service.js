// src/api/services/auth.service.js
const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET; // Pega a chave do .env

class AuthService {
    async login(identifier, password) {
        // [CORREÇÃO] Adiciona .select('+password') para forçar a inclusão da senha
        const user = await User.findOne({
            $or: [{ email: identifier }, { username: identifier }]
        }).select('+password'); // <<< A CORREÇÃO ESTÁ AQUI

        if (!user) {
            throw new Error('Credenciais inválidas.'); // Usuário não encontrado
        }

        // [NOVO] Adiciona verificação de status (do seu novo model)
        if (user.status === 'Inativo') {
             throw new Error('Esta conta de usuário está inativa.');
        }

        // Agora user.password estará definido (o hash)
        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            throw new Error('Credenciais inválidas.'); // Senha incorreta
        }

        // Se deu tudo certo, gera um token
        const payload = {
            id: user._id,
            fullName: user.fullName,
            roles: user.roles // [MODIFICADO] Usa 'roles' (plural) do seu novo model
        };

        if (!JWT_SECRET) {
             console.error("ERRO CRÍTICO: JWT_SECRET não está definida nas variáveis de ambiente.");
             throw new Error('Erro interno do servidor ao gerar token.');
        }

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

        // [NOVO] Popula os perfis de trabalho antes de retornar
        // Isso garante que o Flutter receba os dados do professor/admin no login
        await user.populate('staffProfiles');

        const userObject = user.toObject();
        delete userObject.password; // Remove a senha ANTES de enviar ao cliente

        return { user: userObject, token };
    }
}

module.exports = new AuthService();