const MercadoPagoGateway = require('./mercadopago.gateway');
const CoraGateway = require('./cora.gateway');

class GatewayFactory {
    /**
     * Retorna a instância do Gateway apropriado baseada na configuração da Escola
     * @param {Object} school - O documento da escola (mongoose doc com .lean())
     * @param {String} [forceGateway] - Opcional: Forçar 'CORA' ou 'MERCADOPAGO'
     */
    static create(school, forceGateway = null) {
        
        // 1. Determina qual gateway usar
        const selectedGateway = forceGateway 
            ? forceGateway.toUpperCase() 
            : (school.preferredGateway || 'MERCADOPAGO');

        // 2. Tenta instanciar CORA
        if (selectedGateway === 'CORA') {
            const config = school.coraConfig;

            if (!config) {
                throw new Error('Configuração da Cora não encontrada na escola.');
            }

            // [CORREÇÃO] Identifica o ambiente para buscar no lugar certo
            const isSandbox = config.isSandbox === true;
            const credentials = isSandbox ? config.sandbox : config.production;

            // Valida as credenciais DENTRO do objeto do ambiente correto (sandbox ou production)
            const hasCoraCreds = credentials && 
                                 credentials.clientId && 
                                 credentials.certificateContent && 
                                 credentials.privateKeyContent;

            if (hasCoraCreds) {
                return new CoraGateway(config);
            }
            
            // Se caiu aqui, é porque faltou chave no ambiente selecionado
            const ambiente = isSandbox ? 'SANDBOX' : 'PRODUÇÃO';
            throw new Error(`Escola configurada para Cora (${ambiente}), mas sem credenciais válidas (Client ID ou Certificados faltando).`);
        }

        // 3. Tenta instanciar MERCADO PAGO (Padrão)
        if (school.mercadoPagoConfig && school.mercadoPagoConfig.prodAccessToken) {
            return new MercadoPagoGateway(school.mercadoPagoConfig);
        }

        throw new Error('Nenhum gateway de pagamento configurado ou credenciais ausentes.');
    }
}

module.exports = GatewayFactory;