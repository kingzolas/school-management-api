const { WebSocketServer } = require('ws');
const url = require('url'); // [NOVO] Necessário para ler parâmetros da URL
const appEmitter = require('./eventEmitter');

let wss; // Instância do servidor WebSocket

function initWebSocket(httpServer) {
    // Liga o servidor WebSocket ao servidor HTTP existente
    wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws, req) => {
        // [NOVO] 1. Extrair o ID da Escola da URL de conexão
        // O Front deve conectar assim: new WebSocket('ws://api.com?schoolId=10')
        const parameters = url.parse(req.url, true);
        const schoolId = parameters.query.schoolId || parameters.query.school_id;

        if (!schoolId) {
            console.log('⚠️ Cliente WebSocket rejeitado: schoolId não informado.');
            ws.close(); 
            return;
        }

        // [NOVO] 2. "Etiquetamos" a conexão com o ID da escola
        ws.schoolId = String(schoolId); // Forçamos string para evitar erros de comparação

        console.log(`✅ Cliente WebSocket conectado na escola: ${schoolId}`);

        ws.on('close', () => console.log(`❌ Cliente WebSocket desconectado da escola: ${schoolId}`));
    });

    // --- A MÁGICA ACONTECE AQUI ---
    registerAppListeners();

    console.log('🚀 Servidor WebSocket inicializado com isolamento por escola (Multitenancy).');
}

function registerAppListeners() {
    // --- [NOVO] Solicitações de Matrícula (Web) ---
    appEmitter.on('registration:created', (request) => {
        console.log('Evento: registration:created');
        broadcast({ type: 'NEW_REGISTRATION_REQUEST', payload: request }, request.school_id);
    });

    // --- Alunos ---
    appEmitter.on('student:created', (student) => {
        console.log('Evento: student:created');
        broadcast({ type: 'NEW_STUDENT', payload: student }, student.school_id);
    });

    appEmitter.on('student:updated', (student) => {
        console.log('Evento: student:updated');
        broadcast({ type: 'UPDATED_STUDENT', payload: student }, student.school_id);
    });

    appEmitter.on('student:deleted', (payload) => {
        // ATENÇÃO: O payload de delete DEVE conter { id: ..., school_id: ... }
        console.log('Evento: student:deleted');
        broadcast({ type: 'DELETED_STUDENT', payload: payload }, payload.school_id);
    });

    // --- Usuários ---
    appEmitter.on('user:created', (user) => {
        console.log('Evento: user:created');
        broadcast({ type: 'NEW_USER', payload: user }, user.school_id);
    });

    appEmitter.on('user:updated', (user) => {
        console.log('Evento: user:updated');
        broadcast({ type: 'UPDATED_USER', payload: user }, user.school_id);
    });

    appEmitter.on('user:deleted', (payload) => {
        console.log('Evento: user:deleted');
        broadcast({ type: 'DELETED_USER', payload: payload }, payload.school_id);
    });

    // --- [NOVO] Turmas ---
    appEmitter.on('class:created', (classDoc) => {
        console.log('Evento: class:created');
        broadcast({ type: 'NEW_CLASS', payload: classDoc }, classDoc.school_id);
    });
    appEmitter.on('class:updated', (classDoc) => {
        console.log('Evento: class:updated');
        broadcast({ type: 'UPDATED_CLASS', payload: classDoc }, classDoc.school_id);
    });
    appEmitter.on('class:deleted', (payload) => {
        console.log('Evento: class:deleted');
        broadcast({ type: 'DELETED_CLASS', payload: payload }, payload.school_id);
    });

    // --- [NOVO] Matrículas ---
    appEmitter.on('enrollment:created', (enrollmentDoc) => {
        console.log('Evento: enrollment:created');
        broadcast({ type: 'NEW_ENROLLMENT', payload: enrollmentDoc }, enrollmentDoc.school_id);
    });
    appEmitter.on('enrollment:updated', (enrollmentDoc) => {
        console.log('Evento: enrollment:updated');
        broadcast({ type: 'UPDATED_ENROLLMENT', payload: enrollmentDoc }, enrollmentDoc.school_id);
    });
    appEmitter.on('enrollment:deleted', (payload) => {
        console.log('Evento: enrollment:deleted');
        broadcast({ type: 'DELETED_ENROLLMENT', payload: payload }, payload.school_id);
    });

    // --- [NOVO] Disciplinas ---
    appEmitter.on('subject:created', (subject) => {
        console.log('Evento: subject:created');
        broadcast({ type: 'NEW_SUBJECT', payload: subject }, subject.school_id);
    });
    appEmitter.on('subject:updated', (subject) => {
        console.log('Evento: subject:updated');
        broadcast({ type: 'UPDATED_SUBJECT', payload: subject }, subject.school_id);
    });
    appEmitter.on('subject:deleted', (payload) => {
        console.log('Evento: subject:deleted');
        broadcast({ type: 'DELETED_SUBJECT', payload: payload }, payload.school_id);
    });

    // --- [NOVO] Horários ---
    appEmitter.on('horario:created', (horario) => {
        console.log('Evento: horario:created');
        broadcast({ type: 'NEW_HORARIO', payload: horario }, horario.school_id);
    });
    appEmitter.on('horario:updated', (horario) => {
        console.log('Evento: horario:updated');
        broadcast({ type: 'UPDATED_HORARIO', payload: horario }, horario.school_id);
    });
    appEmitter.on('horario:deleted', (payload) => {
        console.log('Evento: horario:deleted');
        broadcast({ type: 'DELETED_HORARIO', payload: payload }, payload.school_id);
    });

    // --- [NOVO] Eventos (Calendário) ---
    appEmitter.on('evento:created', (evento) => {
        console.log('Evento: evento:created');
        broadcast({ type: 'NEW_EVENTO', payload: evento }, evento.school_id);
    });
    appEmitter.on('evento:updated', (evento) => {
        console.log('Evento: evento:updated');
        broadcast({ type: 'UPDATED_EVENTO', payload: evento }, evento.school_id);
    });
    appEmitter.on('evento:deleted', (payload) => {
        console.log('Evento: evento:deleted');
        broadcast({ type: 'DELETED_EVENTO', payload: payload }, payload.school_id);
    });

    // --- Faturas (Invoice) ---
    appEmitter.on('invoice:created', (invoice) => {
        console.log('Evento: invoice:created');
        broadcast({ type: 'NEW_INVOICE', payload: invoice }, invoice.school_id);
    });

    appEmitter.on('invoice:paid', (invoice) => {
        console.log('Evento: invoice:paid');
        broadcast({ type: 'PAID_INVOICE', payload: invoice }, invoice.school_id);
    });

    appEmitter.on('invoice:updated', (invoice) => {
        console.log('Evento: invoice:updated');
        broadcast({ type: 'UPDATED_INVOICE', payload: invoice }, invoice.school_id);
    });
    // --- [NOVO] Chamada (Attendance) ---
    appEmitter.on('attendance_updated', (payload) => {
        console.log('Evento: attendance_updated');
        broadcast({ type: 'ATTENDANCE_UPDATED', payload: payload }, payload.school_id);
    });
}

/**
 * Envia a mensagem APENAS para clientes conectados na mesma escola do evento.
 * @param {Object} data - Objeto da mensagem { type, payload }
 * @param {String|Number} targetSchoolId - O ID da escola de destino
 */
function broadcast(data, targetSchoolId) {
    if (!wss) return;
    if (!targetSchoolId) {
        console.error('⚠️ ERRO BROADCAST: Tentativa de enviar evento sem school_id:', data.type);
        return;
    }

    const message = JSON.stringify(data);
    const targetIdString = String(targetSchoolId); // Garante comparação String vs String

    wss.clients.forEach((client) => {
        // Verifica conexão aberta E se pertence à mesma escola
        if (client.readyState === client.OPEN && client.schoolId === targetIdString) {
            client.send(message);
        }
    });
}

module.exports = { initWebSocket, broadcast };