const Analytics = require('../models/analytics.model');

class AnalyticsService {
  
  // Salva um novo evento
  async logEvent(data) {
    try {
      return await Analytics.create(data);
    } catch (error) {
      console.error("Erro ao salvar analytics:", error);
      // Não damos throw no erro para não travar a requisição do usuário por causa de métrica
      return null;
    }
  }

  // Gera os dados para o seu Painel Admin
  async getDashboardStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Total de Visitas (Page Views)
    const totalVisits = await Analytics.countDocuments({ event: 'page_view' });

    // 2. Leads (Conversões de Sucesso)
    const leads = await Analytics.countDocuments({ event: 'lead_success' });

    // 3. Funil / Conversão
    const conversionRate = totalVisits > 0 ? ((leads / totalVisits) * 100).toFixed(1) : 0;

    // 4. Agrupamento por Data (para o gráfico de barras)
    // Pega os últimos 7 dias
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const history = await Analytics.aggregate([
      { $match: { 
          event: 'page_view', 
          timestamp: { $gte: sevenDaysAgo } 
      }},
      { $group: {
          _id: { $dateToString: { format: "%d/%m", date: "$timestamp" } },
          count: { $sum: 1 }
      }},
      { $sort: { "_id": 1 } } // Ordena por data
    ]);

    // 5. Últimos eventos (Log)
    const recentLogs = await Analytics.find()
      .sort({ timestamp: -1 })
      .limit(20)
      .select('event timestamp device metadata');

    return {
      totalVisits,
      leads,
      conversionRate: `${conversionRate}%`,
      history: history.map(h => ({ name: h._id, value: h.count })),
      recentLogs
    };
  }
}

module.exports = new AnalyticsService();