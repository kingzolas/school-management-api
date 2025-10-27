const User = require('../models/user.model');
const jwt = require('jsonwebtoken');

// Adicione uma chave secreta no seu arquivo .env
// JWT_SECRET=sua_chave_super_secreta_aqui
const JWT_SECRET = process.env.JWT_SECRET;

class AuthService {
    async login(identifier, password) {
        // Permite login com username OU email
        const user = await User.findOne({
            $or: [{ email: identifier }, { username: identifier }]
        });

        if (!user) {
            throw new Error('Credenciais inválidas.'); // Usuário não encontrado
        }

        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            throw new Error('Credenciais inválidas.'); // Senha incorreta
        }

        // Se deu tudo certo, gera um token
        const payload = {
            id: user._id,
            fullName: user.fullName,
            role: user.role
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' }); // Token expira em 1 dia

        const userObject = user.toObject();
        delete userObject.password;

        return { user: userObject, token };
    }
}

module.exports = new AuthService();