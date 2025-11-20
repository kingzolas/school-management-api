const cron = require('node-cron');
const InvoiceService = require('../api/services/invoice.service');

const initCronJobs = () => {
    console.log('🕰️ Inicializando Cron Jobs...');

    // Roda todos os dias às 08:00 da manhã
    // Formato: Minuto Hora Dia Mês DiaSemana
    cron.schedule('0 8 * * *', async () => {
        console.log('🔔 Executando Job: Lembrete de Vencimento');
        try {
            await InvoiceService.processDailyReminders();
        } catch (error) {
            console.error('❌ Erro no Cron Job de Vencimento:', error);
        }
    }, {
        scheduled: true,
        timezone: "America/Sao_Paulo"
    });
};

module.exports = { initCronJobs };