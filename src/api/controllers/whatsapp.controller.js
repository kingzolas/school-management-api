const whatsappService = require('../services/whatsapp.service');
const School = require('../models/school.model');

class WhatsappController {

    // GET /api/whatsapp/connect
    async connect(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            
            const result = await whatsappService.connectSchool(schoolId);
            
            // Se já estiver conectado ('open'), atualizamos o banco imediatamente
            if (result.status === 'open') {
                await School.findByIdAndUpdate(schoolId, { 
                    'whatsapp.status': 'connected',
                    'whatsapp.instanceName': result.instanceName,
                    'whatsapp.qrCode': null
                });
            }

            // Normaliza o retorno para o front (garante que 'qrcode' exista se houver)
            // A Evolution pode devolver 'base64' ou 'qrcode.base64', o Service já tratou, 
            // mas aqui garantimos a chave JSON correta.
            return res.status(200).json({
                status: result.status,
                instanceName: result.instanceName,
                qrcode: result.qrCode // Front espera 'qrcode' (minúsculo ou camelCase, verifique seu front)
            });

        } catch (error) {
            next(error);
        }
    }

    // GET /api/whatsapp/status
    async status(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            const instanceName = `school_${schoolId}`;
            
            const statusData = await whatsappService.getConnectionStatus(instanceName);
            
            // Sincroniza com banco local
            const dbStatus = statusData.status === 'open' ? 'connected' : 'disconnected';
            await School.findByIdAndUpdate(schoolId, { 'whatsapp.status': dbStatus });

            return res.status(200).json(statusData);
        } catch (error) {
            next(error);
        }
    }

    // [NOVO] Rota para o Front forçar sincronização
    async syncStatus(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            const isConnected = await whatsappService.ensureConnection(schoolId);
            return res.status(200).json({ status: isConnected ? 'connected' : 'disconnected' });
        } catch (error) {
            next(error);
        }
    }

    // DELETE /api/whatsapp/disconnect
    async disconnect(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            await whatsappService.logoutSchool(schoolId);
            return res.status(200).json({ message: 'Desconectado com sucesso' });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new WhatsappController();