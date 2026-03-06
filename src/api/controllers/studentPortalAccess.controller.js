const tempAccessTokenService = require('../services/tempAccessToken.service');

class StudentPortalAccessController {
  async consume(req, res) {
    try {
      const { token } = req.query;

      const result = await tempAccessTokenService.consumeStudentPortalToken(token);

      return res.status(200).json({
        success: true,
        token: result.authToken,
        student: result.student,
      });
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: error.message || 'Não foi possível validar o link de acesso.',
      });
    }
  }
}

module.exports = new StudentPortalAccessController();