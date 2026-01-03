const analyticsService = require('../../api/services/analytics.service');

exports.trackEvent = async (req, res) => {
  try {
    // Tenta pegar o IP real (considerando proxies/render/heroku)
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const eventData = {
      event: req.body.event,
      path: req.body.path,
      device: req.body.device,
      metadata: req.body.metadata,
      ip: ip, 
      timestamp: new Date()
    };

    // Processa em background (não espera salvar para responder o front)
    analyticsService.logEvent(eventData);

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno de analytics' });
  }
};

exports.getStats = async (req, res) => {
  try {
    // Aqui você pode adicionar verificação de admin/senha se quiser proteger
    const stats = await analyticsService.getDashboardStats();
    return res.json(stats);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao buscar métricas' });
  }
};