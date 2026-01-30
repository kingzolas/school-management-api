const NotificationService = require('../services/notification.service');

class NotificationController {
  
  /**
   * GET /logs
   * Busca os logs de notificação (Com filtros e paginação)
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
   * POST /trigger
   * Gatilho Manual COMPLETO (Varredura + Processamento)
   */
  async triggerManualRun(req, res, next) {
    try {
      console.log('⚡ [API] Trigger Manual acionado pelo painel...');
      
      // 1. FORÇA a varredura de faturas antigas e novas AGORA
      // Isso vai buscar no banco e encher a fila
      await NotificationService.scanAndQueueInvoices();

      // 2. Chama o processamento da fila imediatamente para enviar o que achou
      NotificationService.processQueue(); 
      
      res.status(200).json({ 
        success: true, 
        message: 'Varredura e processamento iniciados manualmente. Verifique o terminal.' 
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