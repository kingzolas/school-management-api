const appEmitter = require('../eventEmitter');

/**
 * Dispara eventos garantindo que o school_id esteja presente.
 * @param {Object} req - O request do Express (para pegar o usuario logado)
 * @param {String} eventName - Nome do evento (ex: 'student:deleted')
 * @param {Object|String|Number} payload - O dado (Objeto completo ou apenas o ID)
 */
const smartEmit = (req, eventName, payload) => {
    let dataToSend = payload;

    // Cenário 1: Payload é apenas um ID (comum em deletes)
    if (typeof payload === 'string' || typeof payload === 'number') {
        dataToSend = { 
            id: payload, 
            school_id: req.user.school_id // Injeta o ID da escola automaticamente
        };
    } 
    // Cenário 2: Payload é objeto, mas por algum motivo veio sem school_id
    else if (typeof payload === 'object' && !payload.school_id) {
        dataToSend = { 
            ...payload, 
            school_id: req.user.school_id 
        };
    }

    // Dispara o evento
    appEmitter.emit(eventName, dataToSend);
};

module.exports = smartEmit;