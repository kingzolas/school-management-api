const authStudentService = require('../services/authStudent.service');
const tempAccessTokenService = require('../services/tempAccessToken.service');

class AuthStudentController {
  async login(req, res) {
    console.log('--- [Controller] Tentativa de Login de Aluno ---');
    console.log('Body recebido:', req.body);

    try {
      const { enrollmentNumber, password } = req.body;

      if (!enrollmentNumber || !password) {
        console.log('❌ [Controller] Dados incompletos.');
        return res.status(400).json({
          success: false,
          message: 'Matrícula e senha são obrigatórios.',
        });
      }

      const result = await authStudentService.login(enrollmentNumber, password);

      console.log('✅ [Controller] Login bem-sucedido. Retornando token.');

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('❌ [Controller] Erro capturado:', error.message);
      console.error(error.stack);

      return res.status(401).json({
        success: false,
        message: error.message || 'Credenciais inválidas.',
      });
    }
  }

  async accessByToken(req, res) {
    console.log('--- [Controller] Tentativa de acesso por token temporário ---');

    try {
      const { token } = req.query;

      if (!token) {
        console.log('❌ [Controller] Token não informado.');
        return res.status(400).json({
          success: false,
          message: 'Token de acesso não informado.',
        });
      }

      const result = await tempAccessTokenService.consumeStudentPortalToken(token);

      console.log('✅ [Controller] Acesso temporário validado com sucesso.');

      return res.status(200).json({
        success: true,
        token: result.authToken,
        student: result.student,
      });
    } catch (error) {
      console.error('❌ [Controller] Erro no acesso por token:', error.message);
      console.error(error.stack);

      return res.status(401).json({
        success: false,
        message: error.message || 'Link inválido ou expirado.',
      });
    }
  }
}

module.exports = new AuthStudentController();