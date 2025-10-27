const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Este é o middleware que verifica o token.
 */
const verifyToken = (req, res, next) => {

    // ========================================================
    // ADICIONE ESTE DEBUG AQUI
    // ========================================================
    console.log('--- [AUTH MIDDLEWARE] ---');
    console.log('Recebida requisição para:', req.method, req.path);
    console.log('Cabeçalho Authorization:', req.headers['authorization']);
    // ========================================================

    // O token vem no cabeçalho 'Authorization' no formato 'Bearer <token>'
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        // Se não houver token, o usuário não está autenticado
        console.warn('❌ [AUTH] Falha: Nenhum token encontrado.'); // Debug
        return res.status(403).json({ message: 'Nenhum token fornecido!' });
    }

    // Tenta verificar o token
    jwt.verify(token, JWT_SECRET, (err, decodedPayload) => {
        if (err) {
            // Se o token for inválido (expirado, assinatura errada, etc.)
            console.warn('❌ [AUTH] Falha: Token inválido.', err.message); // Debug
            return res.status(401).json({ message: 'Não autorizado! Token inválido.' });
        }

        // ✅ SUCESSO! O token é válido.
        console.log('✅ [AUTH] Sucesso: Token verificado. Usuário:', decodedPayload.id);
        req.user = decodedPayload;

        // Passa para a próxima função (no seu caso, o studentController.create)
        next();
    });
};

// ... (resto do arquivo) ...

// Exportamos a função para que as rotas possam usá-la
module.exports = {
    verifyToken
    // Você pode adicionar outras funções aqui depois, como 'isAdmin', 'isTeacher', etc.
};