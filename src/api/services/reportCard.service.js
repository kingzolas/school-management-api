const mongoose = require('mongoose');

const ReportCard = require('../models/reportCard.model');
const Enrollment = require('../models/enrollment.model');
const Student = require('../models/student.model');
const ClassModel = require('../models/class.model');
const Subject = require('../models/subject.model');
const Horario = require('../models/horario.model');
const School = require('../models/school.model');
const Tutor = require('../models/tutor.model'); // Adicionado o model de Tutor

class ReportCardService {
  _createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  _normalizeMinimumAverage(school) {
    const value =
      school?.minimumAverage ??
      school?.academicConfig?.minimumAverage ??
      7.0;

    const parsed = Number(value);
    if (Number.isNaN(parsed)) return 7.0;

    return parsed;
  }

  // Mantido como fallback caso algum aluno tenha o nome do responsável salvo direto nele
  _extractResponsibleName(student) {
    return (
      student?.responsible_name ||
      student?.responsibleName ||
      student?.guardianName ||
      student?.guardian_name ||
      student?.tutorName ||
      student?.mother_name ||
      student?.father_name ||
      ''
    );
  }

  _dedupeSubjectsFromHorario(horarios = []) {
    const uniqueMap = new Map();

    for (const horario of horarios) {
      const subjectId = horario?.subjectId?._id || horario?.subjectId;
      const teacherId = horario?.teacherId?._id || horario?.teacherId;

      if (!subjectId || !teacherId) continue;

      const subjectName =
        horario?.subjectId?.name ||
        horario?.subjectName ||
        'Disciplina';

      const teacherName =
        horario?.teacherId?.name ||
        horario?.teacherId?.full_name ||
        horario?.teacherId?.fullName ||
        horario?.teacherName ||
        '';

      const key = `${String(subjectId)}::${String(teacherId)}`;

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          subjectId,
          subjectNameSnapshot: subjectName,
          teacherId,
          teacherNameSnapshot: teacherName,
          testScore: null,
          activityScore: null,
          participationScore: null,
          score: null,
          status: 'Pendente',
          observation: '',
          filledBy: null,
          filledAt: null,
        });
      }
    }

    return Array.from(uniqueMap.values());
  }

  _calculateSubjectStatus(score, minimumAverage) {
    if (score === null || score === undefined || score === '') {
      return 'Pendente';
    }

    const numericScore = Number(score);
    if (Number.isNaN(numericScore)) {
      return 'Pendente';
    }

    return numericScore >= minimumAverage
      ? 'Acima da Média'
      : 'Abaixo da Média';
  }

  _calculateReportCardStatus(subjects = []) {
    if (!subjects.length) return 'Rascunho';

    const filledCount = subjects.filter(
      (item) => item.score !== null && item.score !== undefined
    ).length;

    if (filledCount === 0) return 'Rascunho';
    if (filledCount < subjects.length) return 'Parcial';
    return 'Completo';
  }

  _mergeSubjects(existingSubjects = [], generatedSubjects = [], minimumAverage = 7) {
    const existingMap = new Map();

    for (const item of existingSubjects) {
      const key = `${String(item.subjectId)}::${String(item.teacherId)}`;
      existingMap.set(key, item);
    }

    return generatedSubjects.map((generated) => {
      const key = `${String(generated.subjectId)}::${String(generated.teacherId)}`;
      const existing = existingMap.get(key);

      if (!existing) return generated;

      const mergedScore =
        existing.score !== null && existing.score !== undefined
          ? existing.score
          : null;

      return {
        subjectId: generated.subjectId,
        subjectNameSnapshot:
          existing.subjectNameSnapshot || generated.subjectNameSnapshot,
        teacherId: generated.teacherId,
        teacherNameSnapshot:
          existing.teacherNameSnapshot || generated.teacherNameSnapshot,
        testScore: existing.testScore !== undefined ? existing.testScore : null,
        activityScore: existing.activityScore !== undefined ? existing.activityScore : null,
        participationScore: existing.participationScore !== undefined ? existing.participationScore : null,
        score: mergedScore,
        status: this._calculateSubjectStatus(mergedScore, minimumAverage),
        observation: existing.observation || '',
        filledBy: existing.filledBy || null,
        filledAt: existing.filledAt || null,
      };
    });
  }

  async generateClassReportCards({
    schoolId,
    classId,
    termId,
    schoolYear,
  }) {
    if (!schoolId) {
      throw this._createError('schoolId é obrigatório.', 400);
    }

    if (!classId) {
      throw this._createError('classId é obrigatório.', 400);
    }

    if (!termId) {
      throw this._createError('termId é obrigatório.', 400);
    }

    if (!schoolYear) {
      throw this._createError('schoolYear é obrigatório.', 400);
    }

    console.log(`\n--- [ReportCardService] Iniciando geração de boletins ---`);
    console.log(`Parâmetros recebidos -> Escola: ${schoolId}, Turma: ${classId}, Período: ${termId}, Ano: ${schoolYear}`);

    const school = await School.findOne({ _id: schoolId });
    if (!school) {
      throw this._createError('Escola não encontrada.', 404);
    }

    const classData = await ClassModel.findOne({
      _id: classId,
      school_id: schoolId,
    });

    if (!classData) {
      throw this._createError('Turma não encontrada para esta escola.', 404);
    }

    console.log(`Turma localizada: ${classData.name} (ID: ${classData._id})`);

    const enrollments = await Enrollment.find({
      school_id: schoolId,
      class: classId,
      academicYear: Number(schoolYear),
      status: 'Ativa' 
    }).populate('student');

    if (!enrollments.length) {
      console.log(`[ERRO] Nenhuma matrícula 'Ativa' encontrada para a turma ${classData.name} no ano ${schoolYear}.`);
      throw this._createError(
        `Nenhuma matrícula ativa encontrada para a turma "${classData.name}" no ano letivo de ${schoolYear}. Verifique no menu de alunos se existem matrículas ativas para esta turma neste ano.`,
        404
      );
    }

    console.log(`Matrículas ativas encontradas: ${enrollments.length}`);

    let horarios = await Horario.find({
      school_id: schoolId,
      classId: classId, 
      termId: termId,
    })
      .populate('subjectId')
      .populate('teacherId');

    if (!horarios.length) {
      console.log(`[AVISO] Sem horário no período ${termId}. Buscando qualquer horário global da turma...`);
      horarios = await Horario.find({
        school_id: schoolId,
        classId: classId,
      })
        .populate('subjectId')
        .populate('teacherId');
    }

    if (!horarios.length) {
      console.log(`[ERRO] A grade horária está completamente vazia para a turma ${classData.name}.`);
      throw this._createError(
        `Nenhuma disciplina vinculada à turma "${classData.name}" foi encontrada. Acesse 'Gestão Acadêmica > Horários' e certifique-se de que existem aulas cadastradas para esta turma.`,
        404
      );
    }

    const minimumAverage = this._normalizeMinimumAverage(school);
    const generatedSubjects = this._dedupeSubjectsFromHorario(horarios);

    if (!generatedSubjects.length) {
      throw this._createError(
        'Não foi possível extrair disciplinas únicas a partir do horário cadastrado.',
        400
      );
    }

    console.log(`Disciplinas únicas extraídas do horário: ${generatedSubjects.length}`);

    const results = [];

    for (const enrollment of enrollments) {
      const student = enrollment.student;

      if (!student?._id) continue;

      // --- BUSCA DO NOME DO RESPONSÁVEL ---
      // Procura um tutor que tenha esse aluno na lista de filhos ('students')
    //   const tutor = await Tutor.findOne({ school_id: schoolId, students: student._id });
    const tutor = await Tutor.findOne({ 
        school_id: schoolId, 
        students: { $in: [student._id] } 
      });  
    const fallbackName = this._extractResponsibleName(student);
      
      const responsibleNameSnapshot = tutor 
        ? tutor.fullName 
        : (fallbackName && fallbackName.trim() !== '' ? fallbackName : '');
      // ------------------------------------

      const existingReportCard = await ReportCard.findOne({
        school_id: schoolId,
        schoolYear,
        termId,
        classId,
        studentId: student._id,
      });

      if (!existingReportCard) {
        const subjects = generatedSubjects.map((item) => ({
          ...item,
          status: 'Pendente',
        }));

        const created = await ReportCard.create({
          school_id: schoolId,
          schoolYear,
          termId,
          classId,
          studentId: student._id,
          enrollmentId: enrollment._id,
          gradingType: 'numeric',
          minimumAverage,
          status: this._calculateReportCardStatus(subjects),
          responsibleNameSnapshot, // Salva o nome localizado!
          subjects,
        });

        results.push(created);
        continue;
      }

      existingReportCard.minimumAverage = minimumAverage;
      // Atualiza o nome do responsável se estiver vazio ou caso o tutor tenha mudado
      existingReportCard.responsibleNameSnapshot = responsibleNameSnapshot;

      existingReportCard.subjects = this._mergeSubjects(
        existingReportCard.subjects || [],
        generatedSubjects,
        minimumAverage
      );

      existingReportCard.status = this._calculateReportCardStatus(
        existingReportCard.subjects
      );

      await existingReportCard.save();
      results.push(existingReportCard);
    }

    console.log(`--- [ReportCardService] Processamento concluído. Boletins gerados/atualizados: ${results.length} ---\n`);

    // Retorna populando o nome do aluno para o Flutter
    return await ReportCard.populate(results, [
      { path: 'studentId', select: 'name fullName full_name' }
    ]);
  }

  async getStudentReportCard({
    schoolId,
    classId,
    termId,
    schoolYear,
    studentId,
  }) {
    if (!schoolId || !classId || !termId || !schoolYear || !studentId) {
      throw this._createError(
        'schoolId, classId, termId, schoolYear e studentId são obrigatórios.',
        400
      );
    }

    const reportCard = await ReportCard.findOne({
      school_id: schoolId,
      classId,
      termId,
      schoolYear,
      studentId,
    })
      .populate('studentId')
      .populate('classId')
      .populate('termId')
      .populate('subjects.subjectId')
      .populate('subjects.teacherId')
      .populate('releasedBy');

    if (!reportCard) {
      throw this._createError('Boletim não encontrado.', 404);
    }

    return reportCard;
  }

  async getReportCardById({ reportCardId, schoolId }) {
    if (!reportCardId || !schoolId) {
      throw this._createError('reportCardId e schoolId são obrigatórios.', 400);
    }

    const reportCard = await ReportCard.findOne({
      _id: reportCardId,
      school_id: schoolId,
    })
      .populate('studentId')
      .populate('classId')
      .populate('termId')
      .populate('subjects.subjectId')
      .populate('subjects.teacherId')
      .populate('releasedBy');

    if (!reportCard) {
      throw this._createError('Boletim não encontrado.', 404);
    }

    return reportCard;
  }

  async updateTeacherSubjectScore({
    schoolId,
    reportCardId,
    subjectId,
    teacherUserId,
    score,
    testScore,
    activityScore,
    participationScore,
    observation,
  }) {
    if (!schoolId || !reportCardId || !subjectId || !teacherUserId) {
      throw this._createError(
        'schoolId, reportCardId, subjectId e teacherUserId são obrigatórios.',
        400
      );
    }

    let finalScore = null;
    let tScore = null;
    let aScore = null;
    let pScore = null;

    if (testScore !== undefined || activityScore !== undefined || participationScore !== undefined) {
      tScore = (testScore !== null && testScore !== '') ? Number(testScore) : null;
      aScore = (activityScore !== null && activityScore !== '') ? Number(activityScore) : null;
      pScore = (participationScore !== null && participationScore !== '') ? Number(participationScore) : null;

      if (
        (tScore !== null && Number.isNaN(tScore)) ||
        (aScore !== null && Number.isNaN(aScore)) ||
        (pScore !== null && Number.isNaN(pScore))
      ) {
        throw this._createError('As notas informadas devem ser valores numéricos válidos.', 400);
      }

      if (tScore !== null || aScore !== null || pScore !== null) {
        finalScore = (tScore || 0) + (aScore || 0) + (pScore || 0);
        
        if (finalScore > 10) {
          throw this._createError(`A soma das notas (Prova, Atividades, Participação) deu ${finalScore} e não pode ultrapassar 10.`, 400);
        }
      }
    } 
    else if (score !== undefined && score !== null && score !== '') {
      finalScore = Number(score);
      if (Number.isNaN(finalScore) || finalScore < 0 || finalScore > 10) {
        throw this._createError('A nota deve estar entre 0 e 10.', 400);
      }
    }

    if (finalScore === null) {
      throw this._createError('Nenhuma nota foi informada.', 400);
    }

    const reportCard = await ReportCard.findOne({
      _id: reportCardId,
      school_id: schoolId,
    });

    if (!reportCard) {
      throw this._createError('Boletim não encontrado.', 404);
    }

  const subjectIndex = reportCard.subjects.findIndex(
      (item) => 
        String(item.subjectId) === String(subjectId) && 
        String(item.teacherId) === String(teacherUserId)
    );

    if (subjectIndex === -1) {
      throw this._createError(
        'Disciplina não encontrada ou você não tem permissão para acessá-la neste boletim.',
        404
      );
    }

    const subjectEntry = reportCard.subjects[subjectIndex];
    
    // A verificação abaixo até se torna redundante porque o findIndex já filtrou pelo professor, 
    // mas você pode mantê-la por segurança se quiser.
    if (String(subjectEntry.teacherId) !== String(teacherUserId)) {
      throw this._createError(
        'Você não tem permissão para lançar nota nesta disciplina.',
        403
      );
    }

    reportCard.subjects[subjectIndex].testScore = tScore;
    reportCard.subjects[subjectIndex].activityScore = aScore;
    reportCard.subjects[subjectIndex].participationScore = pScore;
    reportCard.subjects[subjectIndex].score = finalScore;
    reportCard.subjects[subjectIndex].observation = observation || '';
    reportCard.subjects[subjectIndex].filledBy = teacherUserId;
    reportCard.subjects[subjectIndex].filledAt = new Date();
    
    reportCard.subjects[subjectIndex].status = this._calculateSubjectStatus(
      finalScore,
      reportCard.minimumAverage
    );

    reportCard.status = this._calculateReportCardStatus(reportCard.subjects);

    await reportCard.save();

    return reportCard;
  }

  async recalculateReportCardStatus({ reportCardId, schoolId }) {
    if (!reportCardId || !schoolId) {
      throw this._createError('reportCardId e schoolId são obrigatórios.', 400);
    }

    const reportCard = await ReportCard.findOne({
      _id: reportCardId,
      school_id: schoolId,
    });

    if (!reportCard) {
      throw this._createError('Boletim não encontrado.', 404);
    }

    reportCard.subjects = (reportCard.subjects || []).map((item) => ({
      ...item.toObject ? item.toObject() : item,
      status: this._calculateSubjectStatus(
        item.score,
        reportCard.minimumAverage
      ),
    }));

    reportCard.status = this._calculateReportCardStatus(reportCard.subjects);

    await reportCard.save();

    return reportCard;
  }
}

module.exports = new ReportCardService();