const MercadoPagoGateway = require('./mercadopago.gateway');
const CoraGateway = require('./cora.gateway');
const School = require('../models/school.model'); // ✅ IMPORTANTE

class GatewayFactory {

    /**
     * Retorna a instância do Gateway apropriado baseada na configuração da Escola
     * @param {Object} school - Documento da escola (pode vir incompleto)
     * @param {String} [forceGateway]
     */
    static async create(school, forceGateway = null) {

        const selectedGateway = forceGateway
            ? forceGateway.toUpperCase()
            : (school.preferredGateway || 'MERCADOPAGO');

        // =============================
        // CORA
        // =============================
        if (selectedGateway === 'CORA') {

            // ✅ GARANTE QUE OS CAMPOS select:false VENHAM DO BANCO
            const schoolWithSecrets = await School.findById(school._id)
                .select([
                    'coraConfig.isSandbox',
                    'coraConfig.sandbox.clientId',
                    '+coraConfig.sandbox.certificateContent',
                    '+coraConfig.sandbox.privateKeyContent',
                    'coraConfig.production.clientId',
                    '+coraConfig.production.certificateContent',
                    '+coraConfig.production.privateKeyContent'
                ].join(' '))
                .lean();

            if (!schoolWithSecrets || !schoolWithSecrets.coraConfig) {
                throw new Error('Configuração da Cora não encontrada na escola.');
            }

            const config = schoolWithSecrets.coraConfig;
            const isSandbox = config.isSandbox === true;
            const credentials = isSandbox ? config.sandbox : config.production;

            console.log('🔎 [GatewayFactory] Diagnóstico CORA:', {
                schoolId: String(school._id),
                isSandbox,
                hasClientId: !!credentials?.clientId,
                hasCert: !!credentials?.certificateContent,
                hasKey: !!credentials?.privateKeyContent,
                certLength: credentials?.certificateContent?.length || 0,
                keyLength: credentials?.privateKeyContent?.length || 0
            });

            const hasCoraCreds =
                credentials &&
                credentials.clientId &&
                credentials.certificateContent &&
                credentials.privateKeyContent;

            if (hasCoraCreds) {
                return new CoraGateway(config);
            }

            const ambiente = isSandbox ? 'SANDBOX' : 'PRODUÇÃO';

            throw new Error(
                `Escola configurada para Cora (${ambiente}), mas sem credenciais válidas (Client ID ou Certificados faltando).`
            );
        }

        // =============================
        // MERCADO PAGO
        // =============================
        if (school.mercadoPagoConfig && school.mercadoPagoConfig.prodAccessToken) {
            return new MercadoPagoGateway(school.mercadoPagoConfig);
        }

        throw new Error('Nenhum gateway de pagamento configurado ou credenciais ausentes.');
    }
}

module.exports = GatewayFactory;
