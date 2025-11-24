const DashboardService = require('../services/dashboard.service');

class DashboardController {

    async getMetrics(req, res, next) {
        try {
            // Pega o ID da escola do token do usuário logado
            const schoolId = req.user.schoolId;

            if (!schoolId) {
                return res.status(400).json({ message: 'Usuário não vinculado a uma escola.' });
            }

            const data = await DashboardService.getDashboardData(schoolId);
            
            res.status(200).json(data);
        } catch (error) {
            console.error('❌ ERRO [DashboardController]:', error);
            next(error);
        }
    }
}

module.exports = new DashboardController();