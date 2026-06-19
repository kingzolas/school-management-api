const reportCardService = require('../services/reportCard.service');
const reportCardExamImportService = require('../services/reportCardExamImport.service');

class ReportCardController {
  async generateClassReportCards(req, res, next) {
    try {
      const schoolId =
        req.user?.school_id ||
        req.user?.schoolId ||
        req.school_id ||
        req.schoolId ||
        req.body.schoolId;

      const { classId, termId, schoolYear } = req.body;

      const result = await reportCardService.generateClassReportCards({
        schoolId,
        classId,
        termId,
        schoolYear,
      });

      return res.status(201).json({
        success: true,
        message: 'Boletins da turma gerados com sucesso.',
        data: result,
      });
    } catch (error) {
      console.error('[ReportCardController.generateClassReportCards] Erro:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Erro interno ao gerar os boletins da turma.',
        details: error.toString()
      });
    }
  }

  async getStudentReportCard(req, res, next) {
    try {
      const schoolId =
        req.user?.school_id ||
        req.user?.schoolId ||
        req.school_id ||
        req.schoolId ||
        req.query.schoolId;

      const { classId, termId, schoolYear, studentId } = req.query;

      const result = await reportCardService.getStudentReportCard({
        schoolId,
        classId,
        termId,
        schoolYear,
        studentId,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[ReportCardController.getStudentReportCard] Erro:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Erro interno ao buscar o boletim do aluno.',
        details: error.toString()
      });
    }
  }

  async getReportCardById(req, res, next) {
    try {
      const schoolId =
        req.user?.school_id ||
        req.user?.schoolId ||
        req.school_id ||
        req.schoolId ||
        req.query.schoolId;

      const { reportCardId } = req.params;

      const result = await reportCardService.getReportCardById({
        reportCardId,
        schoolId,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[ReportCardController.getReportCardById] Erro:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Erro interno ao buscar o boletim pelo ID.',
        details: error.toString()
      });
    }
  }

  async updateTeacherSubjectScore(req, res, next) {
    try {
      const schoolId =
        req.user?.school_id ||
        req.user?.schoolId ||
        req.school_id ||
        req.schoolId ||
        req.body.schoolId;

      const teacherUserId =
        req.user?._id ||
        req.user?.id ||
        req.user?.userId ||
        req.user?.user_id;

      const { reportCardId, subjectId } = req.params;
      const { score, testScore, activityScore, participationScore, observation } = req.body;

      const result = await reportCardService.updateTeacherSubjectScore({
        schoolId,
        reportCardId,
        subjectId,
        teacherUserId,
        score,
        testScore,
        activityScore,
        participationScore,
        observation,
      });

      return res.status(200).json({
        success: true,
        message: 'Nota lançada com sucesso.',
        data: result,
      });
    } catch (error) {
      console.error('[ReportCardController.updateTeacherSubjectScore] Erro:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Erro interno ao lançar a nota.',
        details: error.toString()
      });
    }
  }

  async recalculateReportCardStatus(req, res, next) {
    try {
      const schoolId =
        req.user?.school_id ||
        req.user?.schoolId ||
        req.school_id ||
        req.schoolId ||
        req.body.schoolId;

      const { reportCardId } = req.params;

      const result = await reportCardService.recalculateReportCardStatus({
        reportCardId,
        schoolId,
      });

      return res.status(200).json({
        success: true,
        message: 'Status do boletim recalculado com sucesso.',
        data: result,
      });
    } catch (error) {
      console.error('[ReportCardController.recalculateReportCardStatus] Erro:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Erro interno ao recalcular o status do boletim.',
        details: error.toString()
      });
    }
  }

  async listImportableExams(req, res, next) {
    try {
      const schoolId =
        req.user?.school_id ||
        req.user?.schoolId ||
        req.school_id ||
        req.schoolId ||
        req.query.schoolId;

      const result = await reportCardExamImportService.listImportableExams({
        schoolId,
        actor: req.user,
        classId: req.query.classId,
        subjectId: req.query.subjectId || null,
        termId: req.query.termId || null,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[ReportCardController.listImportableExams] Erro:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Erro interno ao listar provas disponiveis.',
        details: error.toString()
      });
    }
  }

  async previewExamImport(req, res, next) {
    try {
      const schoolId =
        req.user?.school_id ||
        req.user?.schoolId ||
        req.school_id ||
        req.schoolId ||
        req.query.schoolId;

      const result = await reportCardExamImportService.previewExamImport({
        schoolId,
        actor: req.user,
        examId: req.params.examId,
        classId: req.query.classId,
        subjectId: req.query.subjectId,
        termId: req.query.termId,
        scoreMode: req.query.scoreMode || 'raw',
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[ReportCardController.previewExamImport] Erro:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Erro interno ao preparar preview de importacao.',
        details: error.toString()
      });
    }
  }

  async commitExamImport(req, res, next) {
    try {
      const schoolId =
        req.user?.school_id ||
        req.user?.schoolId ||
        req.school_id ||
        req.schoolId ||
        req.body.schoolId;

      const result = await reportCardExamImportService.commitExamImport({
        schoolId,
        actor: req.user,
        examId: req.params.examId,
        classId: req.body.classId,
        subjectId: req.body.subjectId,
        termId: req.body.termId,
        selectedStudentIds: req.body.selectedStudentIds || null,
        conflictDecisions: req.body.conflictDecisions || {},
        reason: req.body.reason || '',
        scoreMode: req.body.scoreMode || 'raw',
      });

      return res.status(200).json({
        success: true,
        message: 'Importacao de notas da prova concluida.',
        data: result,
      });
    } catch (error) {
      console.error('[ReportCardController.commitExamImport] Erro:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Erro interno ao importar notas da prova.',
        details: error.toString()
      });
    }
  }
}

module.exports = new ReportCardController();
