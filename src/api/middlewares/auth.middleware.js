const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Este é o middleware que verifica o token.
 */
const verifyToken = (req, res, next) => {

    // ========================================================
    // DEBUG VISUAL
    // ========================================================
    console.log('--- [AUTH MIDDLEWARE] ---');
    console.log('Recebida requisição para:', req.method, req.path);
    // ========================================================

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        console.warn('❌ [AUTH] Falha: Nenhum token encontrado.');
        return res.status(403).json({ message: 'Nenhum token fornecido!' });
    }

    jwt.verify(token, JWT_SECRET, (err, decodedPayload) => {
        if (err) {
            console.warn('❌ [AUTH] Falha: Token inválido.', err.message);
            return res.status(401).json({ message: 'Não autorizado! Token inválido ou expirado.' });
        }

        // ✅ SUCESSO! O token é válido.
        // console.log('✅ [AUTH] Sucesso. User ID:', decodedPayload.id, '| Role:', decodedPayload.role);
        
        req.user = decodedPayload;

        // [AJUSTE IMPORTANTE]
        // Se for token de aluno, criamos um atalho 'studentId' para facilitar nos controllers
        if (decodedPayload.role === 'student') {
            req.user.studentId = decodedPayload.id;
        }

        next();
    });
};

module.exports = {
    verifyToken
};