const mongoose = require('mongoose');
const Evaluation = require('../models/evaluation.model');
const Grade = require('../models/grade.model');

exports.saveClassGrades = async ({
  schoolId,
  classId,
  teacherId,
  evaluationData,
  gradesList
}) => {
  // Importação Lazy para evitar dependência circular
  const SchoolYearService = require('./schoolyear.service'); 

  try {
    let evaluation;

    // 1. Lógica de Avaliação (Criar ou Atualizar)
    if (evaluationData._id) {
      // --- EDIÇÃO (UPDATE) ---
      evaluation = await Evaluation.findOne({ 
        _id: evaluationData._id, 
        classInfo: classId 
      });
      
      if (!evaluation) throw new Error("Avaliação não encontrada.");
      
      // Recalcula o bimestre se a data mudar
      const termInfo = await SchoolYearService.findTermByDate(schoolId, evaluationData.date);
      
      // Atualiza os campos básicos
      evaluation.title = evaluationData.title;
      evaluation.date = evaluationData.date;
      evaluation.type = evaluationData.type;
      evaluation.maxScore = evaluationData.maxScore;
      
      // --- Atualiza os NOVOS CAMPOS ---
      evaluation.subject = evaluationData.subject;     // ID da disciplina
      evaluation.startTime = evaluationData.startTime; // "08:00"
      evaluation.endTime = evaluationData.endTime;     // "10:00"
      // --------------------------------
      
      evaluation.term = termInfo.termName;
      evaluation.schoolYear = termInfo.schoolYearId;
      
      await evaluation.save();

    } else {
      // --- CRIAÇÃO (CREATE) ---
      const termInfo = await SchoolYearService.findTermByDate(schoolId, evaluationData.date);

      evaluation = await Evaluation.create({
        school: schoolId,
        classInfo: classId,
        teacher: teacherId,
        title: evaluationData.title,
        type: evaluationData.type,
        date: evaluationData.date,
        maxScore: evaluationData.maxScore,
        
        // --- Insere os NOVOS CAMPOS ---
        subject: evaluationData.subject,     // ID da disciplina
        startTime: evaluationData.startTime, // "08:00"
        endTime: evaluationData.endTime,     // "10:00"
        // ------------------------------

        schoolYear: termInfo.schoolYearId,
        term: termInfo.termName
      });
    }

    // 2. Gravação em Massa das Notas (Upsert)
    // Se a lista de notas vier vazia (apenas criando a agenda), isso é ignorado automaticamente
    if (gradesList && gradesList.length > 0) {
        const bulkOps = gradesList.map(grade => {
            const val = (grade.value === '' || grade.value === null) ? null : grade.value;
            
            return {
                updateOne: {
                    filter: { 
                      evaluation: evaluation._id, 
                      student: grade.studentId 
                    },
                    update: { 
                      $set: { 
                        school: schoolId,
                        class: classId,
                        enrollment: grade.enrollmentId,
                        term: evaluation.term,
                        schoolYear: evaluation.schoolYear,
                        // Também salvamos a matéria na nota para facilitar filtros futuros?
                        // Por enquanto não é estritamente necessário, pois está na evaluation.
                        value: val,
                        feedback: grade.feedback,
                        updatedAt: new Date()
                      } 
                    },
                    upsert: true
                }
            };
        });

        await Grade.bulkWrite(bulkOps);
    }

    return evaluation;

  } catch (error) {
    throw error;
  }
};