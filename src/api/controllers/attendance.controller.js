const attendanceService = require('../services/attendance.service');
const appEmitter = require('../../loaders/eventEmitter');
exports.saveAttendance = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const teacherId = req.user.id;

    const attendanceData = {
      ...req.body,
      schoolId,
      teacherId
    };

    const result = await attendanceService.createOrUpdate(attendanceData);
    
    // [CORREÇÃO] Emitindo evento diretamente
    // Payload deve conter school_id para o broadcast funcionar
    appEmitter.emit('attendance_updated', { 
        classId: req.body.classId,
        school_id: schoolId // CRUCIAL para o WebSocket saber pra quem mandar
    });

    return res.status(200).json({ message: 'Chamada salva com sucesso!', data: result });
  } catch (error) {
    console.error('Erro ao salvar chamada:', error);
    return res.status(500).json({ message: 'Erro interno ao processar chamada.' });
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