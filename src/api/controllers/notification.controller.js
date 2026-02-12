const NotificationService = require('../services/notification.service');

class NotificationController {
  
  /**
   * GET /logs
   * Busca os logs de notificação
   * [CORRIGIDO]: Agora aceita 'limit' para permitir ver todos os erros de uma vez.
   */
  async getLogs(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      // Extrai o limit da query (o service trata se vier undefined ou 0)
      const { status, page, limit } = req.query;

      const result = await NotificationService.getLogs(schoolId, status, page, limit);
      
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /retry-all
   * [NOVO] Reenvia todas as falhas do dia
   * Esse método estava faltando e causando o erro no server.js
   */
  async retryAllFailed(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      
      const result = await NotificationService.retryAllFailed(schoolId);
      
      res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /stats
   * Retorna os contadores totais do dia (Para os Cards do topo)
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
   * Previsão de Cobrança
   */
  async getForecast(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id;
      
      let targetDate = new Date();
      if (req.query.date) {
        targetDate = new Date(req.query.date);
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
      // Não usamos await no processQueue para não travar a requisição, 
      // mas usamos no scan para garantir que a fila foi populada antes de processar.
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