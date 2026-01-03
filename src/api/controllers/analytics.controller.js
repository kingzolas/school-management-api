const analyticsService = require('../../api/services/analytics.service');
const geoip = require('geoip-lite');
const requestIp = require('request-ip');

exports.trackEvent = async (req, res) => {
  try {
    // 1. Captura o IP real (funciona no Render/Heroku por trás de proxy)
    const clientIp = requestIp.getClientIp(req); 
    
    // 2. Descobre a localização baseada no IP
    // Nota: Em localhost o IP é ::1, então o geo vai ser null.
    const geo = geoip.lookup(clientIp);

    const eventData = {
      event: req.body.event,
      path: req.body.path,
      device: req.body.device,
      // Metadata agora recebe as UTMs vindas do front
      metadata: {
        ...req.body.metadata,
        location: geo ? {
          city: geo.city,
          region: geo.region,
          country: geo.country
        } : { city: 'Desconhecido (ou Localhost)', region: '--' },
        source: req.body.metadata?.utm_source || 'direct', // ex: instagram
        medium: req.body.metadata?.utm_medium || 'none'    // ex: stories
      },
      ip: clientIp, // Opcional: Salvar IP pode exigir aviso de privacidade (LGPD)
      timestamp: new Date()
    };

    analyticsService.logEvent(eventData);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Erro analytics:", error);
    return res.status(500).json({ error: 'Erro interno' });
  }
};

exports.getStats = async (req, res) => {
  try {
    const stats = await analyticsService.getDashboardStats();
    
    // ADIÇÃO: Agregação por Hora do Dia (0h - 23h)
    // Isso deve idealmente ser feito no Service com MongoDB Aggregate, 
    // mas vou fazer aqui via JS para não quebrar seu service atual rápido.
    const allEvents = await analyticsService.getAllEvents(); // Você precisará criar esse método no service ou usar o Model direto
    
    const visitsByHour = Array(24).fill(0);
    const visitsByCity = {};

    allEvents.forEach(evt => {
      // Processa Horários
      const hour = new Date(evt.timestamp).getHours(); // Ajustar fuso se necessário (-3h)
      visitsByHour[hour]++;

      // Processa Cidades
      const city = evt.metadata?.location?.city || 'Outros';
      visitsByCity[city] = (visitsByCity[city] || 0) + 1;
    });

    // Formata para o Gráfico
    const hoursData = visitsByHour.map((count, hour) => ({
      name: `${hour}h`,
      value: count
    }));

    const cityData = Object.keys(visitsByCity).map(city => ({
      name: city,
      value: visitsByCity[city]
    })).sort((a, b) => b.value - a.value).slice(0, 5); // Top 5 cidades

    return res.json({
      ...stats,
      hoursData,
      cityData
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao buscar métricas' });
  }
};