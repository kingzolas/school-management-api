const AuthService = require('../services/auth.service');

class AuthController {
    async login(req, res) {
        try {
            const { identifier, password } = req.body; // 'identifier' pode ser email ou username
            if (!identifier || !password) {
                return res.status(400).json({ message: 'Email/usuário e senha são obrigatórios.' });
            }

            const result = await AuthService.login(identifier.toLowerCase(), password);
            res.status(200).json(result);

        } catch (error) {
            res.status(401).json({ message: error.message });
        }
    }
}

module.exports = new AuthController();