const whatsappService = require('../services/whatsapp.service');
const School = require('../models/school.model');

class WhatsappController {
  // GET /api/whatsapp/connect
  async connect(req, res, next) {
    try {
      const schoolId = req.user.school_id;

      const result = await whatsappService.connectSchool(schoolId);

      const now = new Date();
      const update = {
        'whatsapp.instanceName': result.instanceName || `school_${schoolId}`,
        'whatsapp.lastSyncAt': now,
        'whatsapp.lastError': null,
      };

      if (result.status === 'open') {
        update['whatsapp.status'] = 'connected';
        update['whatsapp.qrCode'] = null;
        update['whatsapp.lastConnectedAt'] = now;
      } else if (result.status === 'qrcode' || result.status === 'qr' || result.qrCode) {
        update['whatsapp.status'] = 'qr_pending';
        update['whatsapp.qrCode'] = result.qrCode || null;
      } else {
        update['whatsapp.status'] = 'connecting';
      }

      await School.findByIdAndUpdate(schoolId, update);

      return res.status(200).json({
        status: update['whatsapp.status'],
        instanceName: update['whatsapp.instanceName'],
        qrcode: result.qrCode || null,
      });
    } catch (error) {
      try {
        const schoolId = req.user?.school_id;
        if (schoolId) {
          await School.findByIdAndUpdate(schoolId, {
            'whatsapp.status': 'error',
            'whatsapp.lastError': error.message || 'Erro ao conectar WhatsApp.',
            'whatsapp.lastSyncAt': new Date(),
          });
        }
      } catch (dbError) {
        console.error('❌ Erro ao persistir falha do WhatsApp:', dbError.message);
      }

      next(error);
    }
  }

  // GET /api/whatsapp/status
  async status(req, res, next) {
    try {
      const schoolId = req.user.school_id;
      const instanceName = `school_${schoolId}`;

      const statusData = await whatsappService.getConnectionStatus(instanceName);

      const now = new Date();
      const resolvedStatusQrCode =
        typeof statusData?.qrcode === 'string'
          ? statusData.qrcode
          : statusData?.qrcode?.base64 || null;
      let dbStatus = 'disconnected';
      let qrCode = null;

      if (statusData?.status === 'open') {
        dbStatus = 'connected';
      } else if (
        statusData?.status === 'qrcode' ||
        statusData?.status === 'qr' ||
        resolvedStatusQrCode
      ) {
        dbStatus = 'qr_pending';
        qrCode = resolvedStatusQrCode;
      } else if (statusData?.status === 'connecting') {
        dbStatus = resolvedStatusQrCode ? 'qr_pending' : 'connecting';
        qrCode = resolvedStatusQrCode;
      } else {
        dbStatus = 'disconnected';
      }

      await School.findByIdAndUpdate(schoolId, {
        'whatsapp.instanceName': instanceName,
        'whatsapp.status': dbStatus,
        'whatsapp.lastSyncAt': now,
        'whatsapp.lastError': null,
        ...(dbStatus === 'connected'
          ? { 'whatsapp.lastConnectedAt': now, 'whatsapp.qrCode': null }
          : {}),
        ...(dbStatus === 'disconnected'
          ? { 'whatsapp.lastDisconnectedAt': now, 'whatsapp.qrCode': null }
          : {}),
        ...(qrCode && (dbStatus === 'qr_pending' || dbStatus === 'connecting')
          ? { 'whatsapp.qrCode': qrCode }
          : {}),
      });

      const schoolSnapshot = await School.findById(schoolId).select('+whatsapp.qrCode');
      const persistedQrCode = schoolSnapshot?.whatsapp?.qrCode || null;
      const responseQrCode =
        dbStatus === 'connected' || dbStatus === 'disconnected'
          ? null
          : qrCode || persistedQrCode || null;

      return res.status(200).json({
        ...statusData,
        persistedStatus: dbStatus,
        qrcode: responseQrCode,
        qrCode: responseQrCode,
      });
    } catch (error) {
      try {
        const schoolId = req.user?.school_id;
        if (schoolId) {
          await School.findByIdAndUpdate(schoolId, {
            'whatsapp.status': 'error',
            'whatsapp.lastError': error.message || 'Erro ao consultar status do WhatsApp.',
            'whatsapp.lastSyncAt': new Date(),
          });
        }
      } catch (dbError) {
        console.error('❌ Erro ao persistir falha de status do WhatsApp:', dbError.message);
      }

      next(error);
    }
  }

  // GET /api/whatsapp/sync-status
  async syncStatus(req, res, next) {
    try {
      const schoolId = req.user.school_id;
      const isConnected = await whatsappService.ensureConnection(schoolId);
      const now = new Date();

      await School.findByIdAndUpdate(schoolId, {
        'whatsapp.instanceName': `school_${schoolId}`,
        'whatsapp.status': isConnected ? 'connected' : 'disconnected',
        'whatsapp.lastSyncAt': now,
        'whatsapp.lastError': null,
        ...(isConnected
          ? {
              'whatsapp.qrCode': null,
              'whatsapp.lastConnectedAt': now,
            }
          : {
              'whatsapp.lastDisconnectedAt': now,
            }),
      });

      return res.status(200).json({
        status: isConnected ? 'connected' : 'disconnected',
      });
    } catch (error) {
      try {
        const schoolId = req.user?.school_id;
        if (schoolId) {
          await School.findByIdAndUpdate(schoolId, {
            'whatsapp.status': 'error',
            'whatsapp.lastError': error.message || 'Erro ao sincronizar status do WhatsApp.',
            'whatsapp.lastSyncAt': new Date(),
          });
        }
      } catch (dbError) {
        console.error('❌ Erro ao persistir falha no sync do WhatsApp:', dbError.message);
      }

      next(error);
    }
  }

  // DELETE /api/whatsapp/disconnect
  async disconnect(req, res, next) {
    try {
      const schoolId = req.user.school_id;

      await whatsappService.logoutSchool(schoolId);

      await School.findByIdAndUpdate(schoolId, {
        'whatsapp.instanceName': `school_${schoolId}`,
        'whatsapp.status': 'disconnected',
        'whatsapp.qrCode': null,
        'whatsapp.lastDisconnectedAt': new Date(),
        'whatsapp.lastSyncAt': new Date(),
        'whatsapp.lastError': null,
      });

      return res.status(200).json({
        message: 'Desconectado com sucesso',
      });
    } catch (error) {
      try {
        const schoolId = req.user?.school_id;
        if (schoolId) {
          await School.findByIdAndUpdate(schoolId, {
            'whatsapp.status': 'error',
            'whatsapp.lastError': error.message || 'Erro ao desconectar WhatsApp.',
            'whatsapp.lastSyncAt': new Date(),
          });
        }
      } catch (dbError) {
        console.error('❌ Erro ao persistir falha no disconnect do WhatsApp:', dbError.message);
      }

      next(error);
    }
  }
}

module.exports = new WhatsappController();
