const NotificationService = require('../services/notification.service');

class NotificationController {
  
  /**
   * GET /logs
   * Busca os logs de notificação (Mantido para a lista paginada)
   */
  async getLogs(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const { status, page } = req.query;

      const result = await NotificationService.getLogs(schoolId, status, page);
      
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /stats
   * [NOVO] Retorna os contadores totais do dia (Para os Cards do topo)
   * Resolve o problema de ver apenas 20 itens.
   */
  async getDashboardStats(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const stats = await NotificationService.getDailyStats(schoolId);
      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /forecast
   * [NOVO] Previsão de Cobrança
   * Simula a varredura para uma data (padrão: Amanhã) e diz quanto seria cobrado.
   * Query params: ?date=YYYY-MM-DD (Opcional)
   */
  async getForecast(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      
      // Se não passar data, assume AMANHÃ
      let targetDate = new Date();
      if (req.query.date) {
        targetDate = new Date(req.query.date);
        // Ajuste de fuso simples para garantir dia correto se vier string ISO
        targetDate.setHours(12,0,0,0); 
      } else {
        targetDate.setDate(targetDate.getDate() + 1);
      }

      const forecast = await NotificationService.getForecast(schoolId, targetDate);
      res.status(200).json(forecast);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /trigger
   * Gatilho Manual COMPLETO
   */
  async triggerManualRun(req, res, next) {
    try {
      console.log('⚡ [API] Trigger Manual acionado pelo painel...');
      await NotificationService.scanAndQueueInvoices();
      NotificationService.processQueue(); 
      
      res.status(200).json({ 
        success: true, 
        message: 'Varredura e processamento iniciados manualmente.' 
      });
    } catch (error) {
      console.error("Erro no trigger:", error);
      next(error);
    }
  }

  /**
   * GET /config
   */
  async getConfig(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const config = await NotificationService.getConfig(schoolId);
      res.status(200).json(config || {}); 
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /config
   */
  async saveConfig(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      const config = await NotificationService.saveConfig(schoolId, req.body);
      res.status(200).json(config);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationController();