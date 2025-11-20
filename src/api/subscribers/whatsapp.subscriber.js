const appEmitter = require('../../loaders/eventEmitter.js');
const whatsappService = require('../services/whatsapp.service');
const School = require('../models/school.model');
const Tutor = require('../models/tutor.model.js');

module.exports = () => {
  
  // OUVINTE: Quando uma fatura é paga (Vem do Webhook MP)
  appEmitter.on('invoice:paid', async (invoice) => {
    console.log(`[Event] Fatura ${invoice._id} paga! Iniciando envio de agradecimento...`);

    try {
      // 1. Precisamos do ID da escola e do Tutor para mandar a mensagem
      // O invoice que vem do evento já deve ter esses dados, mas por segurança buscamos
      const schoolId = invoice.school_id;
      const tutorId = invoice.tutor;

      // 2. Validar conexão da escola
      const school = await School.findById(schoolId);
      if (!school || school.whatsapp?.status !== 'connected') {
        return console.log('[Event] Escola sem Zap conectado. Agradecimento cancelado.');
      }

      // 3. Buscar dados do Tutor (Telefone)
      const tutor = await Tutor.findById(tutorId);
      if (!tutor) return;

      const phone = tutor.phoneNumber || tutor.telefone || tutor.celular;
      if (!phone) return;

      // 4. Enviar Mensagem de Sucesso
      const msgSucesso = `✅ Olá ${tutor.fullName.split(' ')[0]}! Confirmamos o pagamento da fatura referente a *${invoice.description}*.\n\nMuito obrigado pela pontualidade! 🚀`;

      await whatsappService.sendText(schoolId, phone, msgSucesso);
      console.log('[Event] Mensagem de agradecimento enviada!');

    } catch (error) {
      console.error('[Event] Erro ao enviar agradecimento:', error.message);
    }
  });

  // OUVINTE: Se quiser avisar sobre negociação aceita, etc.
  // appEmitter.on('negotiation:created', ...);
};