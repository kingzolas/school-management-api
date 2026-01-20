const { MercadoPagoConfig, Payment } = require('mercadopago');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Define a URL base para Webhooks
const NOTIFICATION_BASE_URL = isProduction 
  ? process.env.PROD_URL 
  : process.env.NGROK_URL;

class MercadoPagoGateway {
    constructor(config) {
        if (!config.prodAccessToken) {
            throw new Error('Access Token do Mercado Pago não configurado para esta escola.');
        }

        this.client = new MercadoPagoConfig({
            accessToken: config.prodAccessToken,
            options: { timeout: 5000 }
        });

        this.payment = new Payment(this.client);
    }

    /**
     * Cria uma cobrança PIX no Mercado Pago
     * @param {Object} data - Dados padronizados da cobrança
     */
    async createInvoice(data) {
        const { value, description, dueDate, payer, schoolId, internalId } = data;

        // Converte valor (centavos -> reais)
        const valorEmReais = parseFloat((value / 100).toFixed(2));
        
        // Configura vencimento para final do dia
        const dataVencimento = new Date(dueDate);
        dataVencimento.setHours(23, 59, 59);

        // Monta a URL de notificação específica
        const notificationUrl = NOTIFICATION_BASE_URL ? `${NOTIFICATION_BASE_URL}/api/webhook/mp` : undefined;

        const body = {
            transaction_amount: valorEmReais,
            description: description,
            payment_method_id: 'pix',
            notification_url: notificationUrl,
            date_of_expiration: dataVencimento.toISOString(),
            payer: {
                email: payer.email || 'email@naoinformado.com',
                first_name: payer.name.split(' ')[0],
                last_name: payer.name.split(' ').slice(1).join(' ') || 'Sobrenome',
                identification: {
                    type: 'CPF',
                    number: payer.cpf.replace(/\D/g, ''),
                },
            },
            metadata: { 
                school_id: schoolId.toString(),
                invoice_id: internalId ? internalId.toString() : null
            } 
        };

        try {
            const paymentResponse = await this.payment.create({ body });
            
            // RETORNO PADRONIZADO
            return {
                gateway: 'mercadopago',
                external_id: paymentResponse.id.toString(),
                status: paymentResponse.status, // approved, pending...
                
                // Mapeamento para campos genéricos
                pix_code: paymentResponse.point_of_interaction?.transaction_data?.qr_code,
                pix_qr_base64: paymentResponse.point_of_interaction?.transaction_data?.qr_code_base64,
                boleto_url: paymentResponse.point_of_interaction?.transaction_data?.ticket_url, // No PIX MP, usa-se ticket_url como link visual
                boleto_barcode: null, // MP Pix não tem código de barras de boleto tradicional
                
                // Dados brutos (caso precise debuggar)
                raw: paymentResponse
            };

        } catch (error) {
            console.error('[MercadoPago Gateway] Erro:', error);
            throw new Error(`Falha no Mercado Pago: ${error.message}`);
        }
    }

    // Método para cancelar (baseado no seu código original)
    async cancelInvoice(externalId) {
        try {
            return await this.payment.cancel({ id: externalId });
        } catch (error) {
            console.warn(`[MercadoPago Gateway] Erro ao cancelar ${externalId}:`, error.message);
            // Não relança erro para não travar o fluxo, apenas loga
            return null;
        }
    }
}

module.exports = MercadoPagoGateway;