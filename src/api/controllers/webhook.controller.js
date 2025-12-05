const InvoiceService = require('../services/invoice.service');
const NegotiationService = require('../services/negotiation.service'); // Importa o novo serviço
const appEmitter = require('../../loaders/eventEmitter');

class WebhookController {
/**
   * [NOVO] Lida com notificações do WhatsApp (Evolution API)
   */
  async handleWhatsappWebhook(req, res) {
    try {
      // Responde rápido para a Evolution não ficar tentando de novo (o erro 404 vem daqui)
      res.status(200).json({ status: 'recebido' });

      const { event, data } = req.body;

      // Se for mensagem nova recebida
      if (event === 'messages.upsert' && !data.key.fromMe) {
        const remoteJid = data.key.remoteJid; 
        const phone = remoteJid.split('@')[0];
        const pushName = data.pushName;
        
        // Extrai texto simples
        let textMessage = data.message?.conversation || data.message?.extendedTextMessage?.text || '';
        
        // if (textMessage) {
        //   console.log(`📩 [WhatsApp] Msg de ${pushName} (${phone}): ${textMessage}`);
        // }
      }
    } catch (error) {
      console.error('❌ Erro no Webhook WhatsApp:', error.message);
    }
  }

  /**
   * Lida com as notificações de pagamento do Mercado Pago
   * Agora atua como um Roteador: verifica se é Fatura ou Negociação.
   */
  async handleMpWebhook(req, res, next) {
    console.log('--- 🔔 WEBHOOK MERCADO PAGO RECEBIDO ---');

    try {
      // 1. Responde 200 OK IMEDIATAMENTE.
      // Isso é crucial para o Mercado Pago não dar timeout.
      res.status(200).json({ status: 'recebido' });

      // 2. Inicia o processamento "em segundo plano"
      const paymentId = req.query['data.id'] || req.body.data?.id;
      
      if (!paymentId) {
        console.warn('⚠️ Alerta Webhook MP: Recebido, mas sem "data.id".');
        return;
      }

      console.log(`🔔 Webhook MP recebido. Processando pagamento ID: ${paymentId}`);

      // --- INÍCIO DA LÓGICA DE ROTEAMENTO ---
      
      let processed = false;

      // Tentativa 1: É uma Fatura (Invoice) Padrão?
      try {
        // [IMPORTANTE] Seu InvoiceService.handlePaymentWebhook deve ser ajustado
        // para retornar { processed: false } ou null se o pagamento não for dele.
        const result = await InvoiceService.handlePaymentWebhook(paymentId);
        
        if (result && result.processed) {
          processed = true;
          const { invoice, mpStatus } = result;

          if (mpStatus === 'approved') {
            appEmitter.emit('invoice:paid', invoice);
            console.log(`📡 EVENTO EMITIDO (MP): invoice:paid para fatura [${invoice._id}]`);
          } else {
            appEmitter.emit('invoice:updated', invoice);
            console.log(`📡 EVENTO EMITIDO (MP): invoice:updated para fatura [${invoice._id}]`);
          }
        }
      } catch (invoiceError) {
        console.warn(`Webhook não é Fatura: ${invoiceError.message}`);
        // Não re-lança o erro, pois pode ser uma negociação.
      }

      if (processed) {
        console.log(`✅ Webhook ${paymentId} processado como Fatura.`);
        return; // Sai da função
      }

      // Tentativa 2: É uma Negociação (Negotiation)?
      try {
        // Criamos um método similar no NegotiationService
        const result = await NegotiationService.handlePaymentWebhook(paymentId);

        if (result && result.processed) {
          processed = true;
          const { negotiation, mpStatus } = result;
          
          if (mpStatus === 'approved') {
            appEmitter.emit('negotiation:paid', negotiation);
            console.log(`📡 EVENTO EMITIDO (MP): negotiation:paid para negociação [${negotiation._id}]`);
          } else {
            appEmitter.emit('negotiation:updated', negotiation);
            console.log(`📡 EVENTO EMITIDO (MP): negotiation:updated para negociação [${negotiation._id}]`);
          }
        }
      } catch (negotiationError) {
        console.error(`❌ ERRO GRAVE no Webhook (NegotiationService): ${negotiationError.message}`);
      }
      
      if (processed) {
         console.log(`✅ Webhook ${paymentId} processado como Negociação.`);
      } else {
        console.error(`❌ Webhook Órfão: Pagamento ${paymentId} não foi processado por nenhum serviço.`);
      }
      // --- FIM DA LÓGICA DE ROTEAMENTO ---

    } catch (error) {
      // Este erro só acontece se o res.status(200) falhar (raro)
      console.error(`❌ ERRO CRÍTICO no WebhookController (MP) (pré-resposta): ${error.message}`);
      next(error); 
    }
  }
}

module.exports = new WebhookController();