const AuthStudentService = require('../services/authStudent.service');

class AuthStudentController {

    async login(req, res) {
        try {
            const { enrollmentNumber, password } = req.body;

            if (!enrollmentNumber || !password) {
                return res.status(400).json({ message: 'Matrícula e senha são obrigatórios.' });
            }

            // Chama o serviço
            const result = await AuthStudentService.login(enrollmentNumber, password);

            return res.status(200).json(result);

        } catch (error) {
            console.error('[AuthStudent] Erro no login:', error.message);
            
            // Retorna 401 para qualquer erro de credencial para segurança
            // (ou use a mensagem do erro se preferir ser específico no dev)
            return res.status(401).json({ message: error.message || 'Credenciais inválidas.' });
        }
    }
}

module.exports = new AuthStudentController();