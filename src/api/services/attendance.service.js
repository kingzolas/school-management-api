const Attendance = require('../models/attendance.model');
const Enrollment = require('../models/enrollment.model'); 
const Student = require('../models/student.model'); 

exports.createOrUpdate = async (data) => {
  // Ajuste de datas para pegar o dia inteiro (00:00 a 23:59)
  const startOfDay = new Date(data.date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(data.date);
  endOfDay.setHours(23, 59, 59, 999);

  const query = {
    schoolId: data.schoolId,
    classId: data.classId,
    date: { $gte: startOfDay, $lte: endOfDay }
  };

  const options = { upsert: true, new: true, setDefaultsOnInsert: true };

  const update = {
    ...data,
    'metadata.syncedAt': new Date()
  };

  return await Attendance.findOneAndUpdate(query, update, options);
};

exports.getDailyList = async (schoolId, classId, dateString) => {
  // 1. Definição do Range de Data
  const targetDate = dateString ? new Date(dateString) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  // 2. Verifica se JÁ existe chamada salva no banco para hoje
  const existingAttendance = await Attendance.findOne({
    schoolId, // Aqui mantemos schoolId pois o model de Attendance foi criado por nós assim
    classId,
    date: { $gte: startOfDay, $lte: endOfDay }
  }).populate('records.studentId', 'fullName photoUrl');

  if (existingAttendance) {
    return { type: 'saved', data: existingAttendance };
  }

  // 3. Se NÃO existe, montamos a lista "virgem" baseada nas matrículas
  // [CORREÇÃO CRÍTICA AQUI] - Usando os nomes exatos do seu Banco de Dados
  const enrollments = await Enrollment.find({
    school_id: schoolId,  // Nome exato no banco (snake_case)
    class: classId,       // Nome exato no banco (sem 'Id')
    status: 'Ativa'       // Nome exato no banco (Português)
  }).populate('student', 'fullName photoUrl'); // O campo de ref é 'student'

  console.log(`[AttendanceService] Turma: ${classId}, Matrículas encontradas: ${enrollments.length}`);

  // 4. Mapeia para o formato que o Front espera
  const proposedList = {
    schoolId,
    classId,
    date: targetDate,
    records: enrollments
      .filter(enroll => enroll.student) // Segurança caso algum aluno tenha sido deletado
      .map(enroll => ({
        studentId: enroll.student, // O objeto populado está em 'student'
        status: 'PRESENT',
        observation: ''
      }))
  };

  return { type: 'proposed', data: proposedList };
};

exports.getClassHistory = async (schoolId, classId) => {
  // Usamos aggregate para contar os status sem trazer o objeto inteiro do aluno (performance)
  return await Attendance.aggregate([
    { 
      $match: { 
        schoolId: new mongoose.Types.ObjectId(schoolId),
        classId: new mongoose.Types.ObjectId(classId) 
      } 
    },
    { $sort: { date: -1 } }, // Do mais recente para o mais antigo
    {
      $project: {
        date: 1,
        updatedAt: 1,
        totalStudents: { $size: "$records" },
        presentCount: {
          $size: {
            $filter: {
              input: "$records",
              as: "rec",
              cond: { $eq: ["$$rec.status", "PRESENT"] }
            }
          }
        },
        absentCount: {
          $size: {
            $filter: {
              input: "$records",
              as: "rec",
              cond: { $eq: ["$$rec.status", "ABSENT"] }
            }
          }
        }
      }
    }
  ]);
};

exports.getHistoryByStudent = async (schoolId, studentId) => {
    return await Attendance.find({
        schoolId,
        "records.studentId": studentId
    }).select('date classId records.$');
};