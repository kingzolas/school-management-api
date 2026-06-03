const jwt = require('jsonwebtoken');
const omrProcessingService = require('../services/omrProcessing.service');

const JWT_SECRET = process.env.JWT_SECRET;

function getBearerToken(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader) {
        return null;
    }

    const [scheme, token] = String(authHeader).split(' ');
    if (!/^Bearer$/i.test(scheme) || !token) {
        return null;
    }

    return token;
}

function normalizeRoles(user) {
    return [
        ...(Array.isArray(user?.roles) ? user.roles : []),
        user?.role,
    ]
        .filter(Boolean)
        .map((role) => String(role).trim().toLowerCase());
}

function applyDecodedUser(req, decodedPayload) {
    req.user = decodedPayload;

    if (decodedPayload.school_id && !req.user.schoolId) {
        req.user.schoolId = decodedPayload.school_id;
    }

    if (decodedPayload.role === 'student') {
        req.user.studentId = decodedPayload.id;
    }
}

function decodeBearerIfPresent(req) {
    const token = getBearerToken(req);
    if (!token || !JWT_SECRET) {
        return null;
    }

    try {
        const decodedPayload = jwt.verify(token, JWT_SECRET);
        if (
            decodedPayload?.principalType === 'guardian' ||
            decodedPayload?.tokenType === 'guardian_auth'
        ) {
            return null;
        }

        applyDecodedUser(req, decodedPayload);
        return decodedPayload;
    } catch (_) {
        return null;
    }
}

function requestHasDebugToken(req) {
    const configuredToken = omrProcessingService.getDebugToken();
    const requestToken =
        req.headers['x-omr-debug-token'] ||
        req.headers['x-internal-debug-token'] ||
        req.body?.debugToken ||
        req.query?.debugToken;

    return Boolean(configuredToken && requestToken && String(requestToken) === String(configuredToken));
}

function hasAdminDebugRole(req) {
    const roles = normalizeRoles(req.user);
    return roles.some((role) => ['admin', 'coordenador', 'coordinator'].includes(role));
}

function requireOmrDebugAccess(req, res, next) {
    if (!omrProcessingService.isDebugEnabled()) {
        return res.status(404).json({
            success: false,
            message: 'Debug OMR desativado.',
        });
    }

    if (requestHasDebugToken(req)) {
        decodeBearerIfPresent(req);
        req.omrDebugAuth = { method: 'debug-token' };
        return next();
    }

    const decodedPayload = decodeBearerIfPresent(req);
    if (!decodedPayload) {
        return res.status(403).json({
            success: false,
            message: 'Acesso ao debug OMR nao autorizado.',
        });
    }

    if (!hasAdminDebugRole(req)) {
        return res.status(403).json({
            success: false,
            message: 'Acesso ao debug OMR exige perfil admin ou coordenador.',
        });
    }

    req.omrDebugAuth = { method: 'jwt-role' };
    return next();
}

module.exports = {
    requireOmrDebugAccess,
    requestHasDebugToken,
    hasAdminDebugRole,
};
