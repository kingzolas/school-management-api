const reportCardService = require('../services/reportCard.service');

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
}

module.exports = new ReportCardController();