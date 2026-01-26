const InvoiceService = require('../services/invoice.service');
const NegotiationService = require('../services/negotiation.service'); 
const appEmitter = require('../../loaders/eventEmitter');

class WebhookController {

  /**
   * [WHATSAPP] Webhook da Evolution API
   */
  async handleWhatsappWebhook(req, res) {
    try {
      res.status(200).json({ status: 'recebido' });
      const { event, data } = req.body;

      if (event === 'messages.upsert' && !data.key.fromMe) {
        // Lógica de recebimento de mensagem (mantida original)
        // const remoteJid = data.key.remoteJid; 
        // const textMessage = data.message?.conversation || ...
      }
    } catch (error) {
      console.error('❌ Erro no Webhook WhatsApp:', error.message);
    }
  }

  /**
   * [MERCADO PAGO] Webhook
   * Lógica mantida intacta conforme solicitado
   */
  async handleMpWebhook(req, res) {
    console.log('--- 🔔 WEBHOOK MERCADO PAGO RECEBIDO ---');

    // 1. Responder rápido
    res.status(200).json({ status: 'recebido' });

    // 2. Extrair ID
    const paymentId = req.query['data.id'] || req.body.data?.id;
    
    if (!paymentId) {
      // Alguns eventos do MP não são de pagamento (ex: merchant_order), ignoramos silenciosamente
      return;
    }

    try {
        // No MP, o webhook não manda o status, ele manda "algo mudou no ID 123".
        // O Service terá que buscar os detalhes na API do MP para saber o status.
        // Por isso passamos statusRaw = null, para forçar a consulta.
        
        // Tenta processar como Fatura
        const invResult = await InvoiceService.handlePaymentWebhook(paymentId, 'MERCADO_PAGO', null);
        if (invResult.processed) {
            this._emitEvents(invResult.invoice, 'invoice');
            return;
        }

        // Tenta processar como Negociação
        const negResult = await NegotiationService.handlePaymentWebhook(paymentId);
        if (negResult.processed) {
            this._emitEvents(negResult.negotiation, 'negotiation');
            return;
        }
        
        console.warn(`⚠️ Webhook MP ${paymentId} não encontrado em Faturas nem Negociações.`);

    } catch (error) {
        console.error(`❌ Erro processando Webhook MP ${paymentId}:`, error.message);
    }
  }

  /**
   * [NOVO] [CORA] Webhook
   * Endpoint: /api/webhook/cora
   * Lógica ajustada para ler HEADERS conforme documentação e testes
   */
  async handleCoraWebhook(req, res) {
    // 1. O retorno 200 OK é obrigatório e deve ser imediato para a Cora não reenviar
    res.status(200).send('OK');

    console.log('--- 🏦 WEBHOOK CORA RECEBIDO ---');

    // AJUSTE CRUCIAL: A Cora envia o tipo e o ID no HEADER, não no Body.
    // O Node.js converte headers para lowercase automaticamente.
    const eventType = req.headers['webhook-event-type'];
    const resourceId = req.headers['webhook-resource-id'];

    console.log(`📡 Headers Recebidos -> Evento: ${eventType} | ID: ${resourceId}`);

    if (!eventType || !resourceId) {
        console.warn('⚠️ Webhook Cora recebido sem headers obrigatórios.');
        return;
    }

    // Mapeamento de Status da Cora para Status Interno Genérico
    let statusRaw = null;

    // Verificamos se o evento é de pagamento (liquidação)
    if (eventType === 'invoice.paid' || eventType === 'bank_slip.liquidation') {
        statusRaw = 'paid';
    } else if (eventType === 'invoice.canceled' || eventType === 'invoice.cancelled') {
        statusRaw = 'cancelled';
    } else {
        console.log(`ℹ️ Evento Cora ignorado (não é mudança de status relevante): ${eventType}`);
        return;
    }

    try {
        // Chama o service unificado
        // Passamos statusRaw porque a Cora já nos disse o que aconteceu
        const invResult = await InvoiceService.handlePaymentWebhook(resourceId, 'CORA', statusRaw);
        
        if (invResult.processed) {
            this._emitEvents(invResult.invoice, 'invoice');
            console.log(`✅ Webhook Cora processado com sucesso. Fatura ${invResult.invoice._id} atualizada.`);
        } else {
             // Se não processou, pode ser que o ID não exista ou já estava pago
             console.warn(`⚠️ Webhook Cora ID ${resourceId} não encontrado no banco ou não processado.`);
        }

    } catch (error) {
        console.error(`❌ Erro processando Webhook Cora:`, error.message);
    }
  }

  /**
   * [HELPER] Emite eventos para o sistema (Socket.io / Logs)
   */
  _emitEvents(document, type) {
      if (!document) return;
      
      const status = document.status; // paid, canceled...
      const eventBase = type === 'negotiation' ? 'negotiation' : 'invoice';
      
      if (status === 'paid') {
          appEmitter.emit(`${eventBase}:paid`, document);
          console.log(`📡 EVENTO: ${eventBase}:paid disparado.`);
      } else {
          appEmitter.emit(`${eventBase}:updated`, document);
          console.log(`📡 EVENTO: ${eventBase}:updated disparado.`);
      }
  }
}

module.exports = new WebhookController();