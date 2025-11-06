const InvoiceService = require('../services/invoice.service');
const appEmitter = require('../../loaders/eventEmitter'); // Seu emissor global

class WebhookController {
  /**
   * Lida com as notificações de pagamento do Mercado Pago
   */
  async handleMpWebhook(req, res, next) {
    console.log('--- 🔔 WEBHOOK MERCADO PAGO RECEBIDO ---');
    console.log('Body:', req.body || 'Vazio');
    console.log('Query:', req.query || 'Vazio');

    try {
      // 1. Responde 200 OK IMEDIATAMENTE.
      // O MP só precisa saber que recebemos. Se demorarmos para processar,
      // ele pode dar timeout e tentar de novo, gerando duplicidade.
      res.status(200).json({ status: 'recebido' });

      // 2. Processa o pagamento "em segundo plano" (depois de já ter respondido 200)
      const paymentId = req.query['data.id'] || req.body.data?.id;
      
      if (!paymentId) {
        console.warn('⚠️ Alerta Webhook MP: Recebido, mas sem "data.id".');
        return;
      }

      console.log(`🔔 Webhook MP recebido. Processando pagamento ID: ${paymentId}`);

      // [CORREÇÃO] AQUI ESTÁ A MUDANÇA:
      // De: InvoiceService.handleMpWebhook(paymentId)
      // Para: InvoiceService.handlePaymentWebhook(paymentId)
      const { invoice, mpStatus } = await InvoiceService.handlePaymentWebhook(paymentId);

      // 3. Emite o evento para o WebSocket (notificar o App do Admin/Pai)
      // (Verifica se o status é 'approved' ou 'pending' para enviar o evento correto)
      if (mpStatus === 'approved') {
        appEmitter.emit('invoice:paid', invoice);
        console.log(`📡 EVENTO EMITIDO (MP): invoice:paid para fatura [${invoice._id}]`);
      } else {
        // Se for 'pending', 'in_process', etc.
        appEmitter.emit('invoice:updated', invoice);
        console.log(`📡 EVENTO EMITIDO (MP): invoice:updated para fatura [${invoice._id}]`);
      }

    } catch (error) {
      // Este log é "pós-resposta", pois o res.status(200) já foi enviado
      console.error(`❌ ERRO GRAVE no WebhookController (MP) (pós-resposta): ${error.message}`);
      next(error); // Loga o erro
    }
  }
}

module.exports = new WebhookController();