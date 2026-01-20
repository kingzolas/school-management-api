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
   * Recebe notificação, extrai ID e processa
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
   */
  async handleCoraWebhook(req, res) {
    console.log('--- 🏦 WEBHOOK CORA RECEBIDO ---');
    
    // 1. Responder rápido
    res.status(200).send('OK');

    // O Payload da Cora geralmente vem assim:
    // { "id": "...", "type": "INVOICE.PAID", "data": { "id": "id-do-boleto", ... } }
    const event = req.body;

    if (!event || !event.type) return;

    // Mapeamento de Status da Cora para Status Interno Genérico
    let statusRaw = null;
    if (event.type === 'INVOICE.PAID' || event.type === 'BANK_SLIP.PAID') statusRaw = 'paid';
    else if (event.type === 'INVOICE.CANCELED') statusRaw = 'cancelled';
    
    // ID do Recurso na Cora (Invoice ID)
    const resourceId = event.data?.id || event.resource_id;

    if (!resourceId) {
        console.warn('⚠️ Webhook Cora sem ID do recurso.');
        return;
    }

    console.log(`🏦 Processando evento Cora: ${event.type} para ID: ${resourceId}`);

    try {
        // Chama o service unificado
        // Diferente do MP, a Cora já manda o status no webhook, então passamos statusRaw
        const invResult = await InvoiceService.handlePaymentWebhook(resourceId, 'CORA', statusRaw);
        
        if (invResult.processed) {
            this._emitEvents(invResult.invoice, 'invoice');
            console.log(`✅ Webhook Cora processado com sucesso.`);
        } else {
             console.warn(`⚠️ Webhook Cora ID ${resourceId} não encontrado no banco.`);
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