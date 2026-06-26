const crypto = require('crypto');
const mongoose = require('mongoose');

const ReportCard = require('../models/reportCard.model');
const ReportCardExamImport = require('../models/reportCardExamImport.model');
const Exam = require('../models/exam.model');
const ExamSheet = require('../models/exam-sheet.model');
const Enrollment = require('../models/enrollment.model');
const Periodo = require('../models/periodo.model');
const ReportCardClass = require('../models/class.model');
const Subject = require('../models/subject.model');
const AuditLog = require('../models/auditLog.model');
const reportCardService = require('./reportCard.service');
const examService = require('./exam.service');
const appEmitter = require('../../loaders/eventEmitter');
const {
  ensureClassAccess,
  isPrivilegedActor,
  extractId,
  createHttpError,
} = require('./classAccess.service');

const getObjectIdString = (value) => {
  if (!value) return '';
  if (value._id) return String(value._id);
  return String(value);
};

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const roundGrade = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 10000) / 10000;
};

const sameScore = (left, right) => {
  const a = finiteNumber(left);
  const b = finiteNumber(right);
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.0001;
};

const clonePlain = (value) => {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
};

const shouldLogExamImportDebug = () => {
  return ['true', '1', 'yes', 'sim'].includes(
    String(process.env.EXAM_IMPORT_DEBUG || '').toLowerCase()
  );
};

class ReportCardExamImportService {
  _ensureObjectId(value, label) {
    if (!value || !mongoose.Types.ObjectId.isValid(value)) {
      throw createHttpError(`${label} invalido.`, 400);
    }
  }

  _normalizeReason(reason) {
    return String(reason || '').trim();
  }

  _normalizeScoreMode(scoreMode) {
    const normalized = String(scoreMode || 'raw').trim();
    if (!['raw', 'normalize_to_component'].includes(normalized)) {
      throw createHttpError('scoreMode invalido.', 400);
    }
    return normalized;
  }

  _resolveScoreModeForExam(exam, scoreMode) {
    if (scoreMode && scoreMode !== 'auto') {
      return this._normalizeScoreMode(scoreMode);
    }

    const examMaxScore = finiteNumber(exam?.totalValue);
    return examMaxScore !== null && examMaxScore > 10
      ? 'normalize_to_component'
      : 'raw';
  }

  async _resolveTargetContext({ schoolId, classId, subjectId, termId, academicYearId = null }) {
    const [targetClass, targetSubject, targetTerm] = await Promise.all([
      ReportCardClass.findOne({ _id: classId, school_id: schoolId }).select('name').lean(),
      Subject.findOne({ _id: subjectId, school_id: schoolId }).select('name').lean(),
      Periodo.findOne({ _id: termId, school_id: schoolId })
        .populate('anoLetivoId', 'year')
        .select('titulo anoLetivoId')
        .lean(),
    ]);

    if (!targetClass) {
      throw createHttpError('Turma de destino nao encontrada.', 404);
    }

    if (!targetSubject) {
      throw createHttpError('Disciplina de destino nao encontrada.', 404);
    }

    if (!targetTerm) {
      throw createHttpError('Bimestre de destino nao encontrado.', 404);
    }

    const termAcademicYearId = getObjectIdString(targetTerm.anoLetivoId);
    if (academicYearId && termAcademicYearId && String(academicYearId) !== termAcademicYearId) {
      throw createHttpError('Ano letivo de destino diverge do bimestre selecionado.', 400);
    }

    const academicYearNumber = Number(targetTerm.anoLetivoId?.year);
    if (!Number.isFinite(academicYearNumber)) {
      throw createHttpError('Ano letivo do bimestre de destino nao foi encontrado.', 400);
    }

    return {
      classId: String(classId),
      className: targetClass.name || '',
      subjectId: String(subjectId),
      subjectName: targetSubject.name || '',
      termId: String(termId),
      termName: targetTerm.titulo || '',
      academicYearId: termAcademicYearId || null,
      academicYear: academicYearNumber,
    };
  }

  async _diagnoseMissingReportCard({ schoolId, studentId, classId, termId, academicYear }) {
    const [sameTermDifferentClass, sameClassDifferentTerm, sameClassTermDifferentYear, anyForStudent] =
      await Promise.all([
        ReportCard.findOne({
          school_id: schoolId,
          studentId,
          termId,
          classId: { $ne: classId },
        }).select('_id classId termId schoolYear').lean(),
        ReportCard.findOne({
          school_id: schoolId,
          studentId,
          classId,
          termId: { $ne: termId },
        }).select('_id classId termId schoolYear').lean(),
        ReportCard.findOne({
          school_id: schoolId,
          studentId,
          classId,
          termId,
          schoolYear: { $ne: academicYear },
        }).select('_id classId termId schoolYear').lean(),
        ReportCard.findOne({
          school_id: schoolId,
          studentId,
        }).select('_id classId termId schoolYear').lean(),
      ]);

    if (sameClassTermDifferentYear) return 'wrong_year';
    if (sameTermDifferentClass) return 'wrong_class';
    if (sameClassDifferentTerm) return 'wrong_term';
    if (!anyForStudent) return 'student_not_found';
    return 'missing_report_card';
  }

  _logResolveReportCard({
    examId,
    studentId,
    studentName,
    schoolId,
    targetContext,
    foundReportCard,
    reportCardId = null,
    reason,
  }) {
    if (!shouldLogExamImportDebug()) return;
    console.log('[ExamImportAPI][ResolveReportCard]', {
      examId,
      studentId,
      studentName,
      schoolId: String(schoolId),
      academicYearId: targetContext.academicYearId,
      academicYear: targetContext.academicYear,
      classId: targetContext.classId,
      className: targetContext.className,
      termId: targetContext.termId,
      termName: targetContext.termName,
      subjectId: targetContext.subjectId,
      subjectName: targetContext.subjectName,
      foundReportCard,
      reportCardId,
      reason,
    });
  }

  _buildIdempotencyKey(payload) {
    const selectedStudentIds = Array.isArray(payload.selectedStudentIds)
      ? [...payload.selectedStudentIds].map(String).sort()
      : [];
    const conflictDecisions = payload.conflictDecisions || {};
    const decisionEntries = Object.keys(conflictDecisions)
      .sort()
      .map((key) => [key, conflictDecisions[key]]);

    return crypto
      .createHash('sha256')
      .update(JSON.stringify({
        schoolId: String(payload.schoolId),
        examId: String(payload.examId),
        classId: String(payload.classId),
        subjectId: String(payload.subjectId),
        termId: String(payload.termId),
        academicYearId: payload.academicYearId ? String(payload.academicYearId) : null,
        scoreMode: payload.scoreMode || 'raw',
        selectedStudentIds,
        conflictDecisions: decisionEntries,
      }))
      .digest('hex');
  }

  _isReportCardLocked(reportCard) {
    return Boolean(
      reportCard?.releasedForPrint ||
      ['Liberado', 'Impresso'].includes(String(reportCard?.status || ''))
    );
  }

  _findSubject(reportCard, subjectId, actor) {
    const subjectIdString = String(subjectId);
    const candidates = (reportCard?.subjects || []).filter(
      (subject) => getObjectIdString(subject.subjectId) === subjectIdString
    );

    if (!candidates.length) return null;

    if (isPrivilegedActor(actor)) return candidates[0];

    const actorId = extractId(actor?.id || actor?._id);
    return candidates.find((subject) => getObjectIdString(subject.teacherId) === actorId) || candidates[0];
  }

  _canBaseWrite({ actor, exam, subjectEntry }) {
    if (isPrivilegedActor(actor)) return true;

    const actorId = extractId(actor?.id || actor?._id);
    if (!actorId) return false;

    return (
      actorId === getObjectIdString(exam.teacher_id) &&
      actorId === getObjectIdString(subjectEntry?.teacherId)
    );
  }

  _canOverwriteConflict({ actor, subjectEntry }) {
    if (isPrivilegedActor(actor)) return true;

    const actorId = extractId(actor?.id || actor?._id);
    if (!actorId) return false;

    const sourceImportedBy = getObjectIdString(subjectEntry?.testScoreSource?.importedBy);
    const filledBy = getObjectIdString(subjectEntry?.filledBy);
    const ownerId = sourceImportedBy || filledBy || getObjectIdString(subjectEntry?.teacherId);

    return !ownerId || ownerId === actorId;
  }

  _calculateProposedScore({ sheetScore, sheetMaxScore, examMaxScore, scoreMode }) {
    const originalGrade = finiteNumber(sheetScore);
    const originalMaxGrade = finiteNumber(sheetMaxScore) ?? finiteNumber(examMaxScore);

    if (originalGrade === null) {
      return {
        originalGrade: null,
        originalMaxGrade,
        proposedTestScore: null,
      };
    }

    if (scoreMode === 'normalize_to_component') {
      if (!originalMaxGrade || originalMaxGrade <= 0) {
        return {
          originalGrade,
          originalMaxGrade,
          proposedTestScore: null,
        };
      }

      return {
        originalGrade,
        originalMaxGrade,
        proposedTestScore: roundGrade((originalGrade / originalMaxGrade) * 10),
      };
    }

    return {
      originalGrade,
      originalMaxGrade,
      proposedTestScore: roundGrade(originalGrade),
    };
  }

  _buildScaleStatus({ originalMaxGrade, proposedTestScore, activityScore, participationScore, scoreMode }) {
    if (proposedTestScore === null) {
      return {
        scaleStatus: 'requires_score_mode',
        predictedFinalScore: null,
        canApplyScale: false,
        message: 'Nota da prova ausente.',
      };
    }

    const activity = finiteNumber(activityScore) ?? 0;
    const participation = finiteNumber(participationScore) ?? 0;
    const predictedFinalScore = roundGrade(proposedTestScore + activity + participation);

    if (scoreMode === 'raw' && originalMaxGrade !== null && originalMaxGrade > 10) {
      return {
        scaleStatus: 'score_scale_conflict',
        predictedFinalScore,
        canApplyScale: false,
        message: 'A prova possui escala maior que 10. Confirme normalizacao antes de importar.',
      };
    }

    if (proposedTestScore < 0 || proposedTestScore > 10) {
      return {
        scaleStatus: 'score_scale_conflict',
        predictedFinalScore,
        canApplyScale: false,
        message: 'A nota proposta para Prova esta fora da escala 0 a 10.',
      };
    }

    if (predictedFinalScore > 10) {
      return {
        scaleStatus: 'final_score_exceeds_10',
        predictedFinalScore,
        canApplyScale: false,
        message: 'A soma Prova + Atividade + Participacao ultrapassa 10.',
      };
    }

    return {
      scaleStatus: 'score_scale_ok',
      predictedFinalScore,
      canApplyScale: true,
      message: null,
    };
  }

  _summarizePreview(items) {
    return items.reduce(
      (summary, item) => {
        summary.totalStudents += 1;
        if (item.status === 'will_fill') summary.importableCount += 1;
        if (item.status === 'already_imported' || item.status === 'already_same') summary.noopCount += 1;
        if (item.status === 'conflict_existing_test_score') summary.conflictCount += 1;
        if (item.status === 'pending_exam_result' || item.status === 'missing_exam_sheet') summary.pendingCount += 1;
        if (item.blocked) summary.blockedCount += 1;
        return summary;
      },
      {
        totalStudents: 0,
        importableCount: 0,
        noopCount: 0,
        conflictCount: 0,
        pendingCount: 0,
        blockedCount: 0,
      }
    );
  }

  async _loadExam({ schoolId, examId, actor }) {
    this._ensureObjectId(examId, 'examId');
    const exam = await Exam.findOne({ _id: examId, school_id: schoolId })
      .populate('class_id', 'name')
      .populate('subject_id', 'name')
      .populate('teacher_id', 'fullName name')
      .populate('termId', 'titulo dataInicio dataFim anoLetivoId')
      .lean();

    if (!exam) {
      throw createHttpError('Prova nao encontrada.', 404);
    }

    await ensureClassAccess(actor, schoolId, getObjectIdString(exam.class_id));

    if (!isPrivilegedActor(actor)) {
      const actorId = extractId(actor?.id || actor?._id);
      if (!actorId || actorId !== getObjectIdString(exam.teacher_id)) {
        throw createHttpError('Prova nao encontrada ou sem permissao de acesso.', 404);
      }
    }

    return exam;
  }

  async listImportableExams({ schoolId, actor, classId, subjectId = null, termId = null }) {
    this._ensureObjectId(classId, 'classId');
    await ensureClassAccess(actor, schoolId, classId);

    const filter = {
      school_id: schoolId,
      class_id: classId,
    };

    if (subjectId) {
      this._ensureObjectId(subjectId, 'subjectId');
      filter.subject_id = subjectId;
    }

    if (!isPrivilegedActor(actor)) {
      const actorId = extractId(actor?.id || actor?._id);
      filter.teacher_id = actorId;
    }

    const exams = await Exam.find(filter)
      .sort({ applicationDate: -1, createdAt: -1 })
      .populate('class_id', 'name')
      .populate('subject_id', 'name')
      .populate('teacher_id', 'fullName name')
      .populate('termId', 'titulo dataInicio dataFim anoLetivoId')
      .lean();

    const results = [];
    for (const exam of exams) {
      const termContext = await examService._resolveStoredExamTermContext(exam, schoolId);
      if (termId && String(termContext.termId || '') !== String(termId)) {
        continue;
      }

      const [totalSheets, correctedSheets] = await Promise.all([
        ExamSheet.countDocuments({ school_id: schoolId, exam_id: exam._id }),
        ExamSheet.countDocuments({
          school_id: schoolId,
          exam_id: exam._id,
          grade: { $type: 'number' },
        }),
      ]);

      let importSummary = {
        alreadyImportedCount: 0,
        conflictCount: 0,
        importableCount: 0,
        hasConflicts: false,
        blockedCount: termContext.termResolution.status === 'missing' ||
          termContext.termResolution.status === 'conflict'
          ? 1
          : 0,
        noopCount: 0,
        pendingCount: Math.max(totalSheets - correctedSheets, 0),
      };

      if (
        termContext.termId &&
        !['missing', 'conflict'].includes(termContext.termResolution.status)
      ) {
        try {
          const scoreMode = this._resolveScoreModeForExam(exam, 'auto');
          const preview = await this.previewExamImport({
            schoolId,
            actor,
            examId: getObjectIdString(exam._id),
            classId,
            subjectId: getObjectIdString(exam.subject_id),
            termId: termContext.termId,
            scoreMode,
          });

          importSummary = {
            alreadyImportedCount: preview.items.filter(
              (item) => item.status === 'already_imported' || item.status === 'already_same'
            ).length,
            conflictCount: preview.summary.conflictCount,
            importableCount: preview.summary.importableCount,
            hasConflicts: preview.summary.conflictCount > 0,
            blockedCount: preview.summary.blockedCount,
            noopCount: preview.summary.noopCount,
            pendingCount: preview.summary.pendingCount,
            scoreMode: preview.target.scoreMode,
          };
        } catch (error) {
          importSummary = {
            ...importSummary,
            blockedCount: Math.max(importSummary.blockedCount, 1),
            importSummaryError: error.message,
          };
        }
      }

      results.push({
        examId: getObjectIdString(exam._id),
        title: exam.title,
        classId: getObjectIdString(exam.class_id),
        className: exam.class_id?.name || '',
        subjectId: getObjectIdString(exam.subject_id),
        subjectName: exam.subject_id?.name || '',
        teacherId: getObjectIdString(exam.teacher_id),
        teacherName: exam.teacher_id?.fullName || exam.teacher_id?.name || '',
        termId: termContext.termId,
        termName: termContext.termName,
        termResolution: termContext.termResolution,
        applicationDate: exam.applicationDate || null,
        status: exam.status,
        correctionType: exam.correctionType,
        totalValue: finiteNumber(exam.totalValue),
        totalSheets,
        correctedSheets,
        pendingSheets: Math.max(totalSheets - correctedSheets, 0),
        alreadyImportedCount: importSummary.alreadyImportedCount,
        conflictCount: importSummary.conflictCount,
        importableCount: importSummary.importableCount,
        hasConflicts: importSummary.hasConflicts,
        blockedCount: importSummary.blockedCount,
        noopCount: importSummary.noopCount,
        pendingCount: importSummary.pendingCount,
        scoreMode: importSummary.scoreMode || this._resolveScoreModeForExam(exam, 'auto'),
        importSummaryError: importSummary.importSummaryError || null,
        importBlocked:
          termContext.termResolution.status === 'missing' ||
          termContext.termResolution.status === 'conflict',
      });
    }

    return results;
  }

  async previewExamImport({
    schoolId,
    actor,
    examId,
    classId,
    subjectId,
    termId,
    academicYearId = null,
    scoreMode = 'raw',
  }) {
    this._ensureObjectId(classId, 'classId');
    this._ensureObjectId(subjectId, 'subjectId');
    this._ensureObjectId(termId, 'termId');

    const exam = await this._loadExam({ schoolId, examId, actor });
    const normalizedScoreMode = this._resolveScoreModeForExam(exam, scoreMode);
    const examClassId = getObjectIdString(exam.class_id);
    const examSubjectId = getObjectIdString(exam.subject_id);

    if (String(classId) !== examClassId) {
      throw createHttpError('A prova nao pertence a turma informada.', 400);
    }

    if (String(subjectId) !== examSubjectId) {
      throw createHttpError('A prova nao pertence a disciplina informada.', 400);
    }

    const targetContext = await this._resolveTargetContext({
      schoolId,
      classId,
      subjectId,
      termId,
      academicYearId,
    });

    const termContext = await examService._resolveStoredExamTermContext(exam, schoolId);
    const termBlocked = false;

    const enrollments = await Enrollment.find({
      class: classId,
      school_id: schoolId,
      status: 'Ativa',
    })
      .populate('student', 'fullName name')
      .select('_id student status')
      .lean();

    const studentIds = enrollments
      .map((enrollment) => getObjectIdString(enrollment.student))
      .filter(Boolean);

    const [sheets, reportCards] = await Promise.all([
      studentIds.length
        ? ExamSheet.find({
          school_id: schoolId,
          exam_id: exam._id,
          student_id: { $in: studentIds },
        }).lean()
        : [],
      studentIds.length
        ? ReportCard.find({
          school_id: schoolId,
          classId,
          termId,
          schoolYear: targetContext.academicYear,
          studentId: { $in: studentIds },
        }).lean()
        : [],
    ]);

    const sheetByStudent = new Map(sheets.map((sheet) => [getObjectIdString(sheet.student_id), sheet]));
    const reportCardByStudent = new Map(
      reportCards.map((reportCard) => [getObjectIdString(reportCard.studentId), reportCard])
    );
    const examMaxScore = finiteNumber(exam.totalValue);

    const items = enrollments
      .map((enrollment) => {
        const studentId = getObjectIdString(enrollment.student);
        const sheet = sheetByStudent.get(studentId) || null;
        const reportCard = reportCardByStudent.get(studentId) || null;
        const subjectEntry = this._findSubject(reportCard, subjectId, actor);
        const sheetScore = finiteNumber(sheet?.grade);
        const sheetMaxScore = finiteNumber(sheet?.maxGrade);
        const scoreProposal = this._calculateProposedScore({
          sheetScore,
          sheetMaxScore,
          examMaxScore,
          scoreMode: normalizedScoreMode,
        });
        const scale = this._buildScaleStatus({
          originalMaxGrade: scoreProposal.originalMaxGrade,
          proposedTestScore: scoreProposal.proposedTestScore,
          activityScore: subjectEntry?.activityScore,
          participationScore: subjectEntry?.participationScore,
          scoreMode: normalizedScoreMode,
        });

        const currentTestScore = finiteNumber(subjectEntry?.testScore);
        const activityScore = finiteNumber(subjectEntry?.activityScore);
        const participationScore = finiteNumber(subjectEntry?.participationScore);
        const baseItem = {
          studentId,
          studentName:
            enrollment.student?.fullName ||
            enrollment.student?.name ||
            'Aluno sem nome',
          enrollmentId: getObjectIdString(enrollment._id),
          reportCardId: getObjectIdString(reportCard?._id) || null,
          subjectId: String(subjectId),
          sheetId: getObjectIdString(sheet?._id) || null,
          correctionStatus: sheetScore !== null ? 'corrected' : (sheet ? 'pending' : 'missing_sheet'),
          examGrade: scoreProposal.originalGrade,
          examMaxGrade: scoreProposal.originalMaxGrade,
          proposedTestScore: scoreProposal.proposedTestScore,
          currentTestScore,
          activityScore,
          participationScore,
          predictedFinalScore: scale.predictedFinalScore,
          scoreMode: normalizedScoreMode,
          scaleStatus: scale.scaleStatus,
          blocked: false,
          status: 'will_fill',
          suggestedAction: 'fill',
          message: scale.message,
          source: subjectEntry?.testScoreSource || null,
        };

        if (termBlocked) {
          this._logResolveReportCard({
            examId: getObjectIdString(exam._id),
            studentId,
            studentName: baseItem.studentName,
            schoolId,
            targetContext,
            foundReportCard: Boolean(reportCard),
            reportCardId: getObjectIdString(reportCard?._id) || null,
            reason: 'wrong_term',
          });
          return {
            ...baseItem,
            blocked: true,
            status: 'term_mismatch',
            suggestedAction: 'block',
            message: 'Destino de bimestre invalido para importacao.',
          };
        }

        if (!reportCard) {
          return {
            ...baseItem,
            blocked: true,
            status: 'missing_report_card',
            suggestedAction: 'block',
            message: `Boletim nao encontrado para ${targetContext.className || 'a turma'} no ${targetContext.termName || 'bimestre selecionado'}.`,
            missingReportCardDiagnosis: null,
          };
        }

        this._logResolveReportCard({
          examId: getObjectIdString(exam._id),
          studentId,
          studentName: baseItem.studentName,
          schoolId,
          targetContext,
          foundReportCard: true,
          reportCardId: getObjectIdString(reportCard._id),
          reason: 'ok',
        });

        if (this._isReportCardLocked(reportCard)) {
          return {
            ...baseItem,
            blocked: true,
            status: 'report_card_locked',
            suggestedAction: 'block',
            message: 'Boletim bloqueado/liberado para impressao.',
          };
        }

        if (!subjectEntry) {
          return {
            ...baseItem,
            blocked: true,
            status: 'subject_not_found',
            suggestedAction: 'block',
            message: 'Disciplina nao encontrada no boletim do aluno.',
          };
        }

        if (!this._canBaseWrite({ actor, exam, subjectEntry })) {
          return {
            ...baseItem,
            blocked: true,
            status: 'permission_required',
            suggestedAction: 'block',
            message: 'Usuario sem permissao para importar esta disciplina/turma.',
          };
        }

        if (!sheet) {
          return {
            ...baseItem,
            blocked: true,
            status: 'missing_exam_sheet',
            suggestedAction: 'ignore',
            message: 'Aluno sem folha de prova gerada/corrigida.',
          };
        }

        if (sheetScore === null) {
          return {
            ...baseItem,
            blocked: true,
            status: 'pending_exam_result',
            suggestedAction: 'ignore',
            message: 'Folha sem nota corrigida.',
          };
        }

        if (!scale.canApplyScale) {
          return {
            ...baseItem,
            blocked: true,
            status: scale.scaleStatus,
            suggestedAction: 'block',
            message: scale.message,
          };
        }

        if (currentTestScore !== null && sameScore(currentTestScore, scoreProposal.proposedTestScore)) {
          return {
            ...baseItem,
            status: subjectEntry?.testScoreSource?.examId &&
              getObjectIdString(subjectEntry.testScoreSource.examId) === getObjectIdString(exam._id)
              ? 'already_imported'
              : 'already_same',
            suggestedAction: 'noop',
            message: 'Nota de Prova ja esta igual ao resultado da prova.',
          };
        }

        if (currentTestScore !== null) {
          const canOverwrite = this._canOverwriteConflict({ actor, subjectEntry });
          return {
            ...baseItem,
            blocked: !canOverwrite,
            status: canOverwrite ? 'conflict_existing_test_score' : 'permission_required',
            suggestedAction: canOverwrite ? 'requires_decision' : 'block',
            message: canOverwrite
              ? 'Ja existe nota de Prova diferente no boletim.'
              : 'Nota existente foi lancada por outro usuario ou exige coordenacao.',
          };
        }

        return baseItem;
      })
      .sort((left, right) => left.studentName.localeCompare(right.studentName, 'pt-BR'));

    const summary = this._summarizePreview(items);

    for (const item of items) {
      if (item.status !== 'missing_report_card' || item.reportCardId) continue;
      const diagnosis = await this._diagnoseMissingReportCard({
        schoolId,
        studentId: item.studentId,
        classId,
        termId,
        academicYear: targetContext.academicYear,
      });
      item.missingReportCardDiagnosis = diagnosis;
      this._logResolveReportCard({
        examId: getObjectIdString(exam._id),
        studentId: item.studentId,
        studentName: item.studentName,
        schoolId,
        targetContext,
        foundReportCard: false,
        reportCardId: null,
        reason: diagnosis,
      });
    }

    if (shouldLogExamImportDebug()) {
      for (const item of items) {
        const decision = item.status === 'will_fill'
          ? 'importable'
          : item.status === 'conflict_existing_test_score'
            ? 'conflict'
            : ['already_imported', 'already_same'].includes(item.status)
              ? 'already_imported'
              : 'blocked';
        const checks = {
          hasCorrectedSheet: item.correctionStatus === 'corrected',
          hasNumericScore: item.examGrade !== null && item.examGrade !== undefined,
          hasStudentLink: Boolean(item.studentId),
          hasClassLink: Boolean(examClassId),
          hasSubjectLink: Boolean(examSubjectId),
          hasTermLink: Boolean(termContext.termId),
          hasGradebookTarget: Boolean(item.reportCardId),
          alreadyImported: ['already_imported', 'already_same'].includes(item.status),
          hasConflict: item.status === 'conflict_existing_test_score',
        };
        console.log('[ExamImportAPI][EligibilityDecision]', {
          examId: getObjectIdString(exam._id),
          studentId: item.studentId,
          score: item.examGrade,
          normalizedScore: item.proposedTestScore,
          proposedTestScore: item.proposedTestScore,
          scoreMode: normalizedScoreMode,
          decision,
          reason: item.message || item.status,
          targetReportCardId: item.reportCardId || null,
          targetTermId: targetContext.termId,
          targetClassId: targetContext.classId,
          targetSubjectId: targetContext.subjectId,
          checks,
        });
      }
    }

    return {
      exam: {
        examId: getObjectIdString(exam._id),
        title: exam.title,
        classId: examClassId,
        className: exam.class_id?.name || '',
        subjectId: examSubjectId,
        subjectName: exam.subject_id?.name || '',
        teacherId: getObjectIdString(exam.teacher_id),
        teacherName: exam.teacher_id?.fullName || exam.teacher_id?.name || '',
        termId: termContext.termId,
        termName: termContext.termName,
        termResolution: termContext.termResolution,
        applicationDate: exam.applicationDate || null,
        totalValue: examMaxScore,
        status: exam.status,
        correctionType: exam.correctionType,
      },
      target: {
        classId: String(classId),
        className: targetContext.className,
        subjectId: String(subjectId),
        subjectName: targetContext.subjectName,
        termId: String(termId),
        termName: targetContext.termName,
        academicYearId: targetContext.academicYearId,
        academicYear: targetContext.academicYear,
        scoreMode: normalizedScoreMode,
      },
      canCommit: !termBlocked && items.some((item) => ['will_fill', 'already_same', 'already_imported', 'conflict_existing_test_score'].includes(item.status)),
      termBlocked,
      summary,
      items,
    };
  }

  _normalizeDecisionMap(conflictDecisions = {}) {
    if (Array.isArray(conflictDecisions)) {
      return new Map(
        conflictDecisions
          .filter((item) => item?.studentId)
          .map((item) => [String(item.studentId), item])
      );
    }

    return new Map(
      Object.entries(conflictDecisions || {}).map(([studentId, decision]) => [
        String(studentId),
        typeof decision === 'string' ? { action: decision } : decision,
      ])
    );
  }

  async _writeAuditLog({ schoolId, actorId, reportCard, subjectEntry, previous, current, reason }) {
    await AuditLog.create({
      school: schoolId,
      actor: actorId,
      entity: 'ReportCard',
      entityId: reportCard._id,
      action: 'UPDATE',
      changes: {
        previous,
        current,
      },
      reason,
    });
  }

  async commitExamImport({
    schoolId,
    actor,
    examId,
    classId,
    subjectId,
    termId,
    academicYearId = null,
    selectedStudentIds = null,
    conflictDecisions = {},
    reason = '',
    scoreMode = 'raw',
  }) {
    const normalizedScoreMode = this._normalizeScoreMode(scoreMode);
    const normalizedReason = this._normalizeReason(reason);
    if (normalizedScoreMode === 'normalize_to_component' && !normalizedReason) {
      throw createHttpError('Informe um motivo para normalizar a nota da prova.', 400);
    }

    const decisionMap = this._normalizeDecisionMap(conflictDecisions);
    const idempotencyKey = this._buildIdempotencyKey({
      schoolId,
      examId,
      classId,
      subjectId,
      termId,
      academicYearId,
      selectedStudentIds,
      conflictDecisions,
      scoreMode: normalizedScoreMode,
    });

    const previousBatch = await ReportCardExamImport.findOne({
      school_id: schoolId,
      idempotencyKey,
      status: { $in: ['completed', 'partial', 'noop'] },
    }).lean();

    if (previousBatch) {
      return {
        reused: true,
        batchId: getObjectIdString(previousBatch._id),
        status: previousBatch.status,
        summary: previousBatch.summary,
        items: previousBatch.items,
      };
    }

    const preview = await this.previewExamImport({
      schoolId,
      actor,
      examId,
      classId,
      subjectId,
      termId,
      academicYearId,
      scoreMode: normalizedScoreMode,
    });

    if (preview.termBlocked) {
      throw createHttpError('Importacao bloqueada por divergencia ou ausencia de bimestre.', 409);
    }

    const actorId = extractId(actor?.id || actor?._id);
    if (!actorId) {
      throw createHttpError('Usuario executor invalido.', 403);
    }

    const selectedSet = Array.isArray(selectedStudentIds) && selectedStudentIds.length
      ? new Set(selectedStudentIds.map(String))
      : new Set(preview.items
        .filter((item) => ['will_fill', 'already_same', 'already_imported'].includes(item.status))
        .map((item) => String(item.studentId)));

    let batch;
    try {
      batch = await ReportCardExamImport.create({
        school_id: schoolId,
        examId,
        classId,
        subjectId,
        termId,
        performedBy: actorId,
        reason: normalizedReason,
        scoreMode: normalizedScoreMode,
        idempotencyKey,
        status: 'processing',
        summary: { selectedCount: selectedSet.size },
        items: [],
      });
    } catch (error) {
      if (error?.code === 11000) {
        const existingBatch = await ReportCardExamImport.findOne({
          school_id: schoolId,
          idempotencyKey,
        }).lean();

        if (existingBatch) {
          return {
            reused: true,
            batchId: getObjectIdString(existingBatch._id),
            status: existingBatch.status,
            summary: existingBatch.summary,
            items: existingBatch.items,
          };
        }
      }
      throw error;
    }

    const exam = await this._loadExam({ schoolId, examId, actor });
    const resultItems = [];
    const updatedReportCardIds = [];
    const updatedStudentIds = [];

    for (const item of preview.items) {
      const selected = selectedSet.has(String(item.studentId));
      const decision = decisionMap.get(String(item.studentId)) || {};

      if (!selected && decision.action !== 'overwrite') {
        resultItems.push({
          studentId: item.studentId,
          reportCardId: item.reportCardId,
          sheetId: item.sheetId,
          subjectId,
          previousTestScore: item.currentTestScore,
          newTestScore: item.proposedTestScore,
          previousScore: null,
          newScore: null,
          status: 'ignored',
          action: 'ignore',
          reason: 'Aluno nao selecionado.',
          scaleStatus: item.scaleStatus,
          message: item.message,
        });
        continue;
      }

      if (item.blocked && item.status !== 'conflict_existing_test_score') {
        resultItems.push({
          studentId: item.studentId,
          reportCardId: item.reportCardId,
          sheetId: item.sheetId,
          subjectId,
          previousTestScore: item.currentTestScore,
          newTestScore: item.proposedTestScore,
          previousScore: null,
          newScore: null,
          status: 'blocked',
          action: 'block',
          reason: item.message,
          scaleStatus: item.scaleStatus,
          message: item.message,
        });
        continue;
      }

      if (['already_same', 'already_imported'].includes(item.status)) {
        resultItems.push({
          studentId: item.studentId,
          reportCardId: item.reportCardId,
          sheetId: item.sheetId,
          subjectId,
          previousTestScore: item.currentTestScore,
          newTestScore: item.proposedTestScore,
          previousScore: item.predictedFinalScore,
          newScore: item.predictedFinalScore,
          status: 'noop',
          action: 'noop',
          reason: 'Nota ja estava igual.',
          scaleStatus: item.scaleStatus,
          message: item.message,
        });
        continue;
      }

      if (item.status === 'conflict_existing_test_score') {
        const action = String(decision.action || '').trim();
        if (action === 'ignore') {
          resultItems.push({
            studentId: item.studentId,
            reportCardId: item.reportCardId,
            sheetId: item.sheetId,
            subjectId,
            previousTestScore: item.currentTestScore,
            newTestScore: item.proposedTestScore,
            previousScore: null,
            newScore: null,
            status: 'ignored',
            action: 'ignore',
            reason: decision.reason || 'Conflito ignorado pelo usuario.',
            scaleStatus: item.scaleStatus,
            message: item.message,
          });
          continue;
        }

        if (action !== 'overwrite') {
          resultItems.push({
            studentId: item.studentId,
            reportCardId: item.reportCardId,
            sheetId: item.sheetId,
            subjectId,
            previousTestScore: item.currentTestScore,
            newTestScore: item.proposedTestScore,
            previousScore: null,
            newScore: null,
            status: 'conflict',
            action: 'block',
            reason: 'Conflito exige decisao explicita.',
            scaleStatus: item.scaleStatus,
            message: item.message,
          });
          continue;
        }

        const overwriteReason = this._normalizeReason(decision.reason || normalizedReason);
        if (!overwriteReason) {
          throw createHttpError('Informe um motivo para sobrescrever nota existente.', 400);
        }
      }

      const reportCard = await ReportCard.findOne({
        _id: item.reportCardId,
        school_id: schoolId,
        classId,
        termId,
        studentId: item.studentId,
      });

      if (!reportCard || this._isReportCardLocked(reportCard)) {
        resultItems.push({
          studentId: item.studentId,
          reportCardId: item.reportCardId,
          sheetId: item.sheetId,
          subjectId,
          previousTestScore: item.currentTestScore,
          newTestScore: item.proposedTestScore,
          previousScore: null,
          newScore: null,
          status: 'blocked',
          action: 'block',
          reason: 'Boletim indisponivel ou bloqueado no momento do commit.',
          scaleStatus: item.scaleStatus,
          message: item.message,
        });
        continue;
      }

      const subjectEntry = this._findSubject(reportCard, subjectId, actor);
      if (!subjectEntry || !this._canBaseWrite({ actor, exam, subjectEntry })) {
        resultItems.push({
          studentId: item.studentId,
          reportCardId: item.reportCardId,
          sheetId: item.sheetId,
          subjectId,
          previousTestScore: item.currentTestScore,
          newTestScore: item.proposedTestScore,
          previousScore: null,
          newScore: null,
          status: 'blocked',
          action: 'block',
          reason: 'Permissao insuficiente no momento do commit.',
          scaleStatus: item.scaleStatus,
          message: item.message,
        });
        continue;
      }

      const currentTestScore = finiteNumber(subjectEntry.testScore);
      if (currentTestScore !== null && !sameScore(currentTestScore, item.proposedTestScore)) {
        const decision = decisionMap.get(String(item.studentId)) || {};
        if (String(decision.action || '').trim() !== 'overwrite') {
          resultItems.push({
            studentId: item.studentId,
            reportCardId: item.reportCardId,
            sheetId: item.sheetId,
            subjectId,
            previousTestScore: currentTestScore,
            newTestScore: item.proposedTestScore,
            previousScore: finiteNumber(subjectEntry.score),
            newScore: null,
            status: 'conflict',
            action: 'block',
            reason: 'Nota atual mudou ou diverge; sobrescrita nao confirmada.',
            scaleStatus: item.scaleStatus,
            message: item.message,
          });
          continue;
        }

        if (!this._canOverwriteConflict({ actor, subjectEntry })) {
          resultItems.push({
            studentId: item.studentId,
            reportCardId: item.reportCardId,
            sheetId: item.sheetId,
            subjectId,
            previousTestScore: currentTestScore,
            newTestScore: item.proposedTestScore,
            previousScore: finiteNumber(subjectEntry.score),
            newScore: null,
            status: 'blocked',
            action: 'block',
            reason: 'Sobrescrita exige coordenacao/admin.',
            scaleStatus: item.scaleStatus,
            message: item.message,
          });
          continue;
        }
      }

      if (sameScore(currentTestScore, item.proposedTestScore)) {
        resultItems.push({
          studentId: item.studentId,
          reportCardId: item.reportCardId,
          sheetId: item.sheetId,
          subjectId,
          previousTestScore: currentTestScore,
          newTestScore: item.proposedTestScore,
          previousScore: finiteNumber(subjectEntry.score),
          newScore: finiteNumber(subjectEntry.score),
          status: 'noop',
          action: 'noop',
          reason: 'Nota ja estava igual no commit.',
          scaleStatus: item.scaleStatus,
          message: item.message,
        });
        continue;
      }

      const previousSnapshot = {
        testScore: currentTestScore,
        score: finiteNumber(subjectEntry.score),
        testScoreSource: clonePlain(subjectEntry.testScoreSource),
      };
      const activityScore = finiteNumber(subjectEntry.activityScore) ?? 0;
      const participationScore = finiteNumber(subjectEntry.participationScore) ?? 0;
      const newScore = roundGrade(item.proposedTestScore + activityScore + participationScore);

      if (newScore > 10) {
        resultItems.push({
          studentId: item.studentId,
          reportCardId: item.reportCardId,
          sheetId: item.sheetId,
          subjectId,
          previousTestScore: currentTestScore,
          newTestScore: item.proposedTestScore,
          previousScore: finiteNumber(subjectEntry.score),
          newScore,
          status: 'blocked',
          action: 'block',
          reason: 'Media final ultrapassa 10 no commit.',
          scaleStatus: 'final_score_exceeds_10',
          message: item.message,
        });
        continue;
      }

      subjectEntry.testScore = item.proposedTestScore;
      subjectEntry.score = newScore;
      subjectEntry.status = reportCardService._calculateSubjectStatus(
        newScore,
        reportCard.minimumAverage
      );
      subjectEntry.filledBy = actorId;
      subjectEntry.filledAt = new Date();
      subjectEntry.testScoreSource = {
        type: 'exam_result_import',
        examId,
        examTitle: preview.exam.title,
        sheetId: item.sheetId,
        importBatchId: batch._id,
        importedBy: actorId,
        importedAt: new Date(),
        originalGrade: item.examGrade,
        originalMaxGrade: item.examMaxGrade,
        scoreMode: normalizedScoreMode,
      };

      reportCard.status = reportCardService._calculateReportCardStatus(reportCard.subjects);
      await reportCard.save();

      const currentSnapshot = {
        testScore: subjectEntry.testScore,
        score: subjectEntry.score,
        testScoreSource: clonePlain(subjectEntry.testScoreSource),
        importBatchId: batch._id,
        examId,
      };

      await this._writeAuditLog({
        schoolId,
        actorId,
        reportCard,
        subjectEntry,
        previous: previousSnapshot,
        current: currentSnapshot,
        reason: this._normalizeReason(decisionMap.get(String(item.studentId))?.reason || normalizedReason),
      });

      updatedReportCardIds.push(getObjectIdString(reportCard._id));
      updatedStudentIds.push(String(item.studentId));
      resultItems.push({
        studentId: item.studentId,
        reportCardId: item.reportCardId,
        sheetId: item.sheetId,
        subjectId,
        previousTestScore: previousSnapshot.testScore,
        newTestScore: subjectEntry.testScore,
        previousScore: previousSnapshot.score,
        newScore: subjectEntry.score,
        status: 'updated',
        action: currentTestScore === null ? 'fill' : 'overwrite',
        reason: currentTestScore === null
          ? 'Campo Prova preenchido a partir da prova.'
          : 'Campo Prova sobrescrito a partir da prova.',
        scaleStatus: item.scaleStatus,
        message: item.message,
      });
    }

    const summary = resultItems.reduce(
      (acc, item) => {
        if (item.status === 'updated') acc.updatedCount += 1;
        if (item.status === 'noop') acc.noopCount += 1;
        if (item.status === 'ignored') acc.ignoredCount += 1;
        if (item.status === 'conflict') acc.conflictCount += 1;
        if (item.status === 'blocked') acc.blockedCount += 1;
        if (item.status === 'failed') acc.failedCount += 1;
        return acc;
      },
      {
        updatedCount: 0,
        noopCount: 0,
        ignoredCount: 0,
        conflictCount: 0,
        blockedCount: 0,
        failedCount: 0,
        selectedCount: selectedSet.size,
      }
    );

    const status = summary.conflictCount > 0 || summary.blockedCount > 0 || summary.failedCount > 0
      ? 'partial'
      : summary.updatedCount > 0
        ? 'completed'
        : 'noop';

    batch.status = status;
    batch.summary = summary;
    batch.items = resultItems;
    await batch.save();

    const websocketPayload = {
      schoolId: String(schoolId),
      school_id: String(schoolId),
      classId: String(classId),
      termId: String(termId),
      subjectId: String(subjectId),
      examId: String(examId),
      importBatchId: getObjectIdString(batch._id),
      updatedReportCardIds,
      updatedStudentIds,
      updatedCount: summary.updatedCount,
      ignoredCount: summary.ignoredCount,
      conflictCount: summary.conflictCount,
      blockedCount: summary.blockedCount,
      noopCount: summary.noopCount,
      performedBy: actorId,
      timestamp: new Date().toISOString(),
    };

    appEmitter.emit('report-card:exam-imported', websocketPayload);
    if (summary.updatedCount > 0) {
      appEmitter.emit('report-card:updated', websocketPayload);
    }

    return {
      reused: false,
      batchId: getObjectIdString(batch._id),
      status,
      summary,
      websocketPayload,
      items: resultItems,
    };
  }
}

module.exports = new ReportCardExamImportService();
