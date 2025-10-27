const EventEmitter = require('events');

// Cria uma instância global que será usada por toda a app
const appEmitter = new EventEmitter();

module.exports = appEmitter;