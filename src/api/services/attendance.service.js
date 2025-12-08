const Attendance = require('../models/attendance.model');
const Enrollment = require('../models/enrollment.model'); 
const Student = require('../models/student.model'); 
const mongoose = require('mongoose');

exports.createOrUpdate = async (data) => {
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
  const targetDate = dateString ? new Date(dateString) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const existingAttendance = await Attendance.findOne({
    schoolId, 
    classId,
    date: { $gte: startOfDay, $lte: endOfDay }
  }).populate('records.studentId', 'fullName photoUrl');

  if (existingAttendance) {
    return { type: 'saved', data: existingAttendance };
  }

  const enrollments = await Enrollment.find({
    school_id: schoolId, 
    class: classId, 
    status: 'Ativa'
  }).populate('student', 'fullName photoUrl'); 

  const proposedList = {
    schoolId,
    classId,
    date: targetDate,
    records: enrollments
      .filter(enroll => enroll.student) 
      .map(enroll => ({
        studentId: enroll.student, 
        status: 'PRESENT',
        observation: ''
      }))
  };

  return { type: 'proposed', data: proposedList };
};

// =================================================================
// [CORREÇÃO APLICADA AQUI]
// =================================================================
exports.getClassHistory = async (schoolId, classId) => {
  return await Attendance.aggregate([
    { 
      $match: { 
        schoolId: new mongoose.Types.ObjectId(schoolId),
        classId: new mongoose.Types.ObjectId(classId) 
      } 
    },
    { $sort: { date: -1 } }, 
    {
      $project: {
        date: 1,
        updatedAt: 1,
        // Mantemos os contadores pois são úteis para o card de resumo
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
        },
        // [IMPORTANTE] Adicionamos 'records: 1' para enviar a lista detalhada
        // Sem isso, o frontend recebe o dia, mas não sabe QUEM faltou.
        records: 1 
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