const AuthStudentService = require('../services/authStudent.service');

class AuthStudentController {

    async login(req, res) {
        console.log('--- [Controller] Tentativa de Login de Aluno ---');
        console.log('Body recebido:', req.body); // Vê se os dados chegaram

        try {
            const { enrollmentNumber, password } = req.body;

            if (!enrollmentNumber || !password) {
                console.log('❌ [Controller] Dados incompletos.');
                return res.status(400).json({ message: 'Matrícula e senha são obrigatórios.' });
            }

            // Chama o serviço
            const result = await AuthStudentService.login(enrollmentNumber, password);

            console.log('✅ [Controller] Login bem-sucedido. Retornando token.');
            return res.status(200).json(result);

        } catch (error) {
            console.error('❌ [Controller] Erro capturado:', error.message);
            // Log do stack trace para ver onde o código quebrou, se foi bug
            console.error(error.stack); 
            
            // Retornamos 401, mas o log acima vai nos dizer a verdade
            return res.status(401).json({ message: error.message || 'Credenciais inválidas.' });
        }
    }
}

module.exports = new AuthStudentController();