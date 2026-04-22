const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notification.controller');
const jwt = require('jsonwebtoken');
const GuardianAccessAccount = require('../models/guardianAccessAccount.model');

// Importação Correta do Middleware (Destructuring)
const { verifyToken } = require('../middlewares/auth.middleware');

const JWT_SECRET = process.env.JWT_SECRET;
const GUARDIAN_JWT_SECRET =
    process.env.GUARDIAN_JWT_SECRET || process.env.JWT_SECRET;

function tokenFromRequest(req) {
    const authHeader = req.headers.authorization;
    return authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : null;
}

function verifyJwt(token, secret) {
    if (!token || !secret) return null;
    try {
        return jwt.verify(token, secret);
    } catch (_) {
        return null;
    }
}

async function verifyAppNotificationViewer(req, res, next) {
    const token = tokenFromRequest(req);
    if (!token) {
        return res.status(403).json({ message: 'Nenhum token fornecido.' });
    }

    const staffPayload = verifyJwt(token, JWT_SECRET);
    if (
        staffPayload &&
        staffPayload.principalType !== 'guardian' &&
        staffPayload.tokenType !== 'guardian_auth'
    ) {
        const roles = Array.isArray(staffPayload.roles)
            ? staffPayload.roles
            : [staffPayload.role].filter(Boolean);

        req.notificationViewer = {
            viewerType: 'staff',
            viewerId: staffPayload.id || staffPayload._id,
            schoolId: staffPayload.schoolId || staffPayload.school_id,
            roles,
            name: staffPayload.fullName || staffPayload.name || null,
        };
        return next();
    }

    const guardianPayload = verifyJwt(token, GUARDIAN_JWT_SECRET);
    if (
        !guardianPayload ||
        guardianPayload.principalType !== 'guardian' ||
        guardianPayload.tokenType !== 'guardian_auth'
    ) {
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
    }

    try {
        const account = await GuardianAccessAccount.findOne({
            _id: guardianPayload.accountId,
            school_id: guardianPayload.school_id,
            tutorId: guardianPayload.tutorId,
        }).select('status blockedUntil tokenVersion school_id tutorId');

        if (!account) {
            return res.status(401).json({ message: 'Conta de responsável não encontrada.' });
        }
        if (Number(account.tokenVersion || 0) !== Number(guardianPayload.tokenVersion || 0)) {
            return res.status(401).json({ message: 'Token de responsável expirado.' });
        }
        if (account.status !== 'active') {
            return res.status(403).json({ message: 'Conta de responsável indisponível.' });
        }
        if (account.blockedUntil && new Date(account.blockedUntil) > new Date()) {
            return res.status(423).json({ message: 'Conta de responsável temporariamente bloqueada.' });
        }

        req.notificationViewer = {
            viewerType: 'guardian',
            viewerId: String(account.tutorId),
            accountId: String(account._id),
            schoolId: String(account.school_id),
        };
        return next();
    } catch (error) {
        return res.status(401).json({ message: 'Token de responsável inválido.' });
    }
}

// --- DEBUG DE SEGURANÇA (Para garantir que o Controller carregou) ---
if (!NotificationController.getLogs || !NotificationController.saveConfig) {
    console.error("❌ ERRO CRÍTICO: NotificationController não exportou os métodos corretamente.");
}

// Aplica a proteção de login em todas as rotas
router.get('/app', verifyAppNotificationViewer, NotificationController.listAppNotifications);
router.patch('/app/read-all', verifyAppNotificationViewer, NotificationController.markAllAppNotificationsRead);
router.patch('/app/:id/read', verifyAppNotificationViewer, NotificationController.markAppNotificationRead);

router.use(verifyToken);

// --- Definição das Rotas ---

// Monitoramento
router.get('/logs', NotificationController.getLogs);

// Rota de reenvio em massa
router.post('/retry-all', NotificationController.retryAllFailed);
router.post('/clear-queue', NotificationController.clearQueue);

router.post('/trigger', NotificationController.triggerManualRun);

// ✅ NOVA ROTA: Gatilho de liberação em massa do mês
router.post('/trigger-month', NotificationController.triggerMonthInvoices);

router.get('/stats', NotificationController.getDashboardStats);
router.get('/transport-logs', NotificationController.getTransportLogs);
router.get('/forecast', NotificationController.getForecast);

// Configuração
router.get('/config', NotificationController.getConfig);
router.post('/config', NotificationController.saveConfig);
router.post('/enqueue', NotificationController.enqueueInvoice);

module.exports = router;
