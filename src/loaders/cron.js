const cron = require('node-cron');

const InvoiceService = require('../api/services/invoice.service');
const WhatsappBotService = require('../api/services/whatsappBot.service');
const tempAccessTokenService = require('../api/services/tempAccessToken.service');

const initCronJobs = () => {
    console.log('🕰️ Inicializando Cron Jobs...');

    // ------------------------------------------------------------------
    // 🔔 JOB 1 - Lembretes de vencimento (já existente)
    // Roda todos os dias às 08:00
    // ------------------------------------------------------------------
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


    // ------------------------------------------------------------------
    // 🤖 JOB 2 - Expirar sessões antigas do WhatsApp Bot
    // roda a cada 10 minutos
    // ------------------------------------------------------------------
    cron.schedule('*/10 * * * *', async () => {
        try {

            const result = await WhatsappBotService.expireOldSessions();

            if (result?.modifiedCount > 0) {
                console.log(`🧹 Sessões WhatsApp expiradas: ${result.modifiedCount}`);
            }

        } catch (error) {
            console.error('❌ Erro limpando sessões do WhatsApp Bot:', error);
        }

    }, {
        scheduled: true,
        timezone: "America/Sao_Paulo"
    });


    // ------------------------------------------------------------------
    // 🔐 JOB 3 - Expirar tokens temporários do portal
    // roda a cada 10 minutos
    // ------------------------------------------------------------------
    cron.schedule('*/10 * * * *', async () => {
        try {

            const result = await tempAccessTokenService.revokeExpiredTokens();

            if (result?.modifiedCount > 0) {
                console.log(`🧹 Tokens temporários expirados: ${result.modifiedCount}`);
            }

        } catch (error) {
            console.error('❌ Erro limpando tokens temporários:', error);
        }

    }, {
        scheduled: true,
        timezone: "America/Sao_Paulo"
    });

};

module.exports = { initCronJobs };