const attendanceService = require('../services/attendance.service');
const appEmitter = require('../../loaders/eventEmitter');
const User = require('../models/user.model'); // [NOVO] Necessário para buscar os gestores
const admin = require('../../config/firebase'); // [NOVO] Sua instância do Firebase Admin

exports.saveAttendance = async (req, res) => {
  try {
    const schoolId = req.user.schoolId; // O middleware popula isso
    const teacherId = req.user.id;
    const teacherName = req.user.fullName || "Professor"; 

    const attendanceData = {
      ...req.body,
      schoolId,
      teacherId
    };

    // 1. Salva a chamada no banco de dados
    const result = await attendanceService.createOrUpdate(attendanceData);
    
    // 2. Notificação via WebSocket (Para quem está com o app/web aberto)
    appEmitter.emit('attendance_updated', { 
        classId: req.body.classId,
        school_id: schoolId 
    });

    // 3. [NOVO] Notificação Push via Firebase (Para celulares em background)
    // Buscamos usuários Admin/Coordenador DA MESMA ESCOLA que tenham tokens
    try {
        const managers = await User.find({
            school_id: schoolId, // Nome do campo no banco (verifique se é school_id ou schoolId no seu User Model)
            roles: { $in: ['Admin', 'Coordenador'] },
            fcmToken: { $exists: true, $ne: [] }
        }).select('fcmToken');

        // Junta todos os tokens em um único array plano
        const tokens = managers.flatMap(u => u.fcmToken);

        if (tokens.length > 0) {
            console.log(`🔔 Preparando notificação para ${tokens.length} dispositivos.`);
            
            const message = {
                notification: {
                    title: 'Chamada Realizada ✅',
                    body: `${teacherName} finalizou a chamada da turma.`
                },
                // Dados extras para o app saber o que abrir ao clicar
                data: {
                    type: 'ATTENDANCE_COMPLETED',
                    classId: req.body.classId,
                    teacherId: teacherId
                },
                tokens: tokens // Envia para todos de uma vez (Multicast)
            };

            const response = await admin.messaging().sendMulticast(message);
            console.log(`✅ Push enviado: ${response.successCount} sucessos, ${response.failureCount} falhas.`);
        }
    } catch (pushError) {
        // [IMPORTANTE] A falha na notificação NÃO deve travar a resposta da API
        console.error('⚠️ Erro ao enviar Push Notification (Não crítico):', pushError);
    }

    return res.status(200).json({ message: 'Chamada salva com sucesso!', data: result });
  } catch (error) {
    console.error('Erro ao salvar chamada:', error);
    return res.status(500).json({ message: 'Erro interno ao processar chamada.' });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const { classId } = req.params;
    const result = await attendanceService.getClassHistory(req.user.schoolId, classId);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Erro ao buscar histórico:', error);
    return res.status(500).json({ message: 'Erro ao buscar histórico.' });
  }
};

exports.getAttendanceSheet = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const { classId } = req.params;
    const { date } = req.query; // Espera ?date=2023-10-25

    if (!classId) {
      return res.status(400).json({ message: 'ID da turma é obrigatório.' });
    }

    const result = await attendanceService.getDailyList(schoolId, classId, date);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Erro ao buscar lista de chamada:', error);
    return res.status(500).json({ message: 'Erro ao buscar dados.' });
  }
};