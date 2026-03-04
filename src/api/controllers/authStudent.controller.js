const authStudentService = require('../services/authStudent.service');

class AuthStudentController {

    async login(req, res) {
        console.log('--- [Controller] Tentativa de Login de Aluno ---');
        console.log('Body recebido:', req.body); // Vê se os dados chegaram

        try {
            const { enrollmentNumber, password } = req.body;

            if (!enrollmentNumber || !password) {
                console.log('❌ [Controller] Dados incompletos.');
                return res.status(400).json({ 
                    success: false, 
                    message: 'Matrícula e senha são obrigatórios.' 
                });
            }

            // Chama o serviço
            const result = await authStudentService.login(enrollmentNumber, password);

            console.log('✅ [Controller] Login bem-sucedido. Retornando token.');
            
            // Retorna status 200 e espalha o result (token e student)
            return res.status(200).json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('❌ [Controller] Erro capturado:', error.message);
            // Log do stack trace para ver onde o código quebrou, se foi bug
            console.error(error.stack); 
            
            // Retornamos 401 (Não autorizado) para falha de credenciais
            return res.status(401).json({ 
                success: false, 
                message: error.message || 'Credenciais inválidas.' 
            });
        }
    }
}

module.exports = new AuthStudentController();