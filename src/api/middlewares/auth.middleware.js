const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const verifyToken = (req, res, next) => {
    // console.log('--- [AUTH MIDDLEWARE] ---'); // Pode comentar o debug se quiser

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(403).json({ message: 'Nenhum token fornecido!' });
    }

    jwt.verify(token, JWT_SECRET, (err, decodedPayload) => {
        if (err) {
            return res.status(401).json({ message: 'Não autorizado! Token inválido ou expirado.' });
        }

        // 1. Atribui o payload decodificado ao req.user
        req.user = decodedPayload;

        // ==================================================================
        // CORREÇÃO DO ERRO DA DASHBOARD
        // O token traz 'school_id', mas os controllers esperam 'schoolId'
        // ==================================================================
        if (decodedPayload.school_id && !req.user.schoolId) {
            req.user.schoolId = decodedPayload.school_id;
        }
        // ==================================================================

        // Helper para alunos
        if (decodedPayload.role === 'student') {
            req.user.studentId = decodedPayload.id;
        }

        next();
    });

    // Adiciona uma função helper direto no request
req.emitEvent = (eventName, data) => {
    const payload = (typeof data === 'object') ? data : { id: data };
    
    // Garante que o school_id exista
    if (!payload.school_id && req.user.school_id) {
        payload.school_id = req.user.school_id;
    }
    
    appEmitter.emit(eventName, payload);
};
};

module.exports = {
    verifyToken
};