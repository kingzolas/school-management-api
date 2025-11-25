const { WebSocketServer } = require('ws');
const appEmitter = require('./eventEmitter');


let wss; // Vamos manter a instância do servidor WebSocket aqui

function initWebSocket(httpServer) {
    // Liga o servidor WebSocket ao servidor HTTP existente
    wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
        console.log('Cliente WebSocket conectado.');
        ws.on('close', () => console.log('Cliente WebSocket desconectado.'));
    });

    // --- A MÁGICA ACONTECE AQUI ---
    // Ele fica "ouvindo" os eventos de negócio da nossa aplicação

// --- [NOVO] Solicitações de Matrícula (Web) ---
    appEmitter.on('registration:created', (request) => {
        console.log('Evento Recebido: registration:created');
        broadcast({ type: 'NEW_REGISTRATION_REQUEST', payload: request });
    });

    // Alunos
    appEmitter.on('student:created', (student) => {
        console.log('Ouvindo evento: student:created');
        broadcast({ type: 'NEW_STUDENT', payload: student });
    });

    appEmitter.on('student:updated', (student) => {
        console.log('Ouvindo evento: student:updated');
        broadcast({ type: 'UPDATED_STUDENT', payload: student });
    });

    appEmitter.on('student:deleted', (studentId) => {
        console.log('Ouvindo evento: student:deleted');
        broadcast({ type: 'DELETED_STUDENT', payload: { id: studentId } });
    });

    // Usuários (podemos adicionar mais aqui)
    appEmitter.on('user:created', (user) => {
        console.log('Ouvindo evento: user:created');
        broadcast({ type: 'NEW_USER', payload: user });
    });

    // Usuários
    appEmitter.on('user:created', (user) => {
        console.log('Ouvindo evento: user:created');
        // 'user' já deve vir sem a senha do service
        broadcast({ type: 'NEW_USER', payload: user });
    });

    appEmitter.on('user:updated', (user) => {
        console.log('Ouvindo evento: user:updated');
        // 'user' já deve vir sem a senha do service
        broadcast({ type: 'UPDATED_USER', payload: user });
    });

    appEmitter.on('user:deleted', (userId) => {
        console.log('Ouvindo evento: user:deleted');
        broadcast({ type: 'DELETED_USER', payload: { id: userId } });
    });

    // --- [NOVO] Turmas ---
    appEmitter.on('class:created', (classDoc) => {
        console.log('Evento Recebido: class:created');
        broadcast({ type: 'NEW_CLASS', payload: classDoc });
    });
    appEmitter.on('class:updated', (classDoc) => {
        console.log('Evento Recebido: class:updated');
        broadcast({ type: 'UPDATED_CLASS', payload: classDoc });
    });
    appEmitter.on('class:deleted', (payload) => { // payload é { id: ... }
        console.log('Evento Recebido: class:deleted');
        broadcast({ type: 'DELETED_CLASS', payload: payload });
    });


    // --- [NOVO] Matrículas ---
    appEmitter.on('enrollment:created', (enrollmentDoc) => {
        console.log('Evento Recebido: enrollment:created');
        // Enviamos a matrícula populada
        broadcast({ type: 'NEW_ENROLLMENT', payload: enrollmentDoc });
    });
    appEmitter.on('enrollment:updated', (enrollmentDoc) => {
        console.log('Evento Recebido: enrollment:updated');
         // Enviamos a matrícula populada e atualizada
        broadcast({ type: 'UPDATED_ENROLLMENT', payload: enrollmentDoc });
    });
    appEmitter.on('enrollment:deleted', (payload) => { // payload é { id: ... }
        console.log('Evento Recebido: enrollment:deleted');
        broadcast({ type: 'DELETED_ENROLLMENT', payload: payload });
    });


    // --- [NOVO] Disciplinas ---
    appEmitter.on('subject:created', (subject) => {
        console.log('Evento Recebido: subject:created');
        broadcast({ type: 'NEW_SUBJECT', payload: subject });
    });
    appEmitter.on('subject:updated', (subject) => {
        console.log('Evento Recebido: subject:updated');
        broadcast({ type: 'UPDATED_SUBJECT', payload: subject });
    });
    appEmitter.on('subject:deleted', (payload) => { // payload é { id: ... }
        console.log('Evento Recebido: subject:deleted');
        broadcast({ type: 'DELETED_SUBJECT', payload: payload });
    });

    // --- [NOVO] Horários ---
    appEmitter.on('horario:created', (horario) => {
        console.log('Evento Recebido: horario:created');
        broadcast({ type: 'NEW_HORARIO', payload: horario });
    });
    appEmitter.on('horario:updated', (horario) => {
        console.log('Evento Recebido: horario:updated');
        broadcast({ type: 'UPDATED_HORARIO', payload: horario });
    });
    appEmitter.on('horario:deleted', (horario) => { // payload é o doc deletado
        console.log('Evento Recebido: horario:deleted');
        broadcast({ type: 'DELETED_HORARIO', payload: horario });
    });

    // --- [NOVO] Eventos (Calendário) ---
    appEmitter.on('evento:created', (evento) => {
        console.log('Evento Recebido: evento:created');
        broadcast({ type: 'NEW_EVENTO', payload: evento });
    });
    appEmitter.on('evento:updated', (evento) => {
        console.log('Evento Recebido: evento:updated');
        broadcast({ type: 'UPDATED_EVENTO', payload: evento });
    });
    appEmitter.on('evento:deleted', (evento) => { // payload é o doc deletado
        console.log('Evento Recebido: evento:deleted');
        broadcast({ type: 'DELETED_EVENTO', payload: evento });
    });
    // --- FIM [NOVO] ---

    appEmitter.on('invoice:created', (invoice) => {
        console.log('Evento Recebido: invoice:created');
        // O payload é a fatura recém-criada
        broadcast({ type: 'NEW_INVOICE', payload: invoice });
    });

    appEmitter.on('invoice:paid', (invoice) => {
        console.log('Evento Recebido: invoice:paid');
        // O payload é a fatura atualizada (status: 'paid')
        broadcast({ type: 'PAID_INVOICE', payload: invoice });
    });

    appEmitter.on('invoice:updated', (invoice) => {
        console.log('Evento Recebido: invoice:updated');
        // O payload é a fatura atualizada (ex: 'canceled' ou 'pending')
        broadcast({ type: 'UPDATED_INVOICE', payload: invoice });
    });
    // --- FIM [NOVO] ---



    // etc...

    console.log('Servidor WebSocket inicializado e ouvindo eventos.');
}

// Função para enviar a mensagem para TODOS os clientes conectados
function broadcast(data) {
    if (!wss) return;

    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    });
}

module.exports = { initWebSocket, broadcast };