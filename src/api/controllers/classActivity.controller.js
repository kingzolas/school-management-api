const classActivityService = require('../services/classActivity.service');

function getSchoolId(req) {
  const schoolId = req?.user?.schoolId || req?.user?.school_id || null;

  if (!schoolId) {
    const error = new Error('Usuario nao autenticado ou sem escola vinculada.');
    error.statusCode = 403;
    throw error;
  }

  return schoolId;
}

function sendActivityError(res, error, fallbackMessage) {
  const statusCode =
    error.statusCode || (error.name === 'CastError' ? 400 : 500);

  return res.status(statusCode).json({
    message: error.message || fallbackMessage,
  });
}

class ClassActivityController {
  async createForClass(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const { classId } = req.params;

      const result = await classActivityService.createForClass({
        schoolId,
        classId,
        actor: req.user,
        data: req.body,
      });

      return res.status(201).json(result);
    } catch (error) {
      console.error('Erro ao criar atividade da turma:', error);
      return sendActivityError(
        res,
        error,
        'Erro ao criar atividade da turma.'
      );
    }
  }

  async listByClass(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const { classId } = req.params;

      const result = await classActivityService.listByClass({
        schoolId,
        classId,
        actor: req.user,
        filters: req.query,
      });

      return res.status(200).json(result);
    } catch (error) {
      console.error('Erro ao listar atividades da turma:', error);
      return sendActivityError(
        res,
        error,
        'Erro ao listar atividades da turma.'
      );
    }
  }

  async getById(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const { activityId } = req.params;

      const result = await classActivityService.getById({
        schoolId,
        activityId,
        actor: req.user,
      });

      return res.status(200).json(result);
    } catch (error) {
      console.error('Erro ao buscar atividade:', error);
      return sendActivityError(res, error, 'Erro ao buscar atividade.');
    }
  }

  async update(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const { activityId } = req.params;

      const result = await classActivityService.update({
        schoolId,
        activityId,
        actor: req.user,
        data: req.body,
      });

      return res.status(200).json(result);
    } catch (error) {
      console.error('Erro ao atualizar atividade:', error);
      return sendActivityError(res, error, 'Erro ao atualizar atividade.');
    }
  }

  async remove(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const { activityId } = req.params;

      const result = await classActivityService.cancel({
        schoolId,
        activityId,
        actor: req.user,
      });

      return res.status(200).json({
        message: 'Atividade cancelada com sucesso.',
        activity: result,
      });
    } catch (error) {
      console.error('Erro ao cancelar atividade:', error);
      return sendActivityError(res, error, 'Erro ao cancelar atividade.');
    }
  }

  async getSubmissions(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const { activityId } = req.params;

      const result = await classActivityService.getSubmissions({
        schoolId,
        activityId,
        actor: req.user,
      });

      return res.status(200).json(result);
    } catch (error) {
      console.error('Erro ao buscar entregas da atividade:', error);
      return sendActivityError(
        res,
        error,
        'Erro ao buscar entregas da atividade.'
      );
    }
  }

  async bulkUpsertSubmissions(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const { activityId } = req.params;

      const result = await classActivityService.bulkUpsertSubmissions({
        schoolId,
        activityId,
        actor: req.user,
        updates: req.body?.updates || [],
      });

      return res.status(200).json(result);
    } catch (error) {
      console.error('Erro ao atualizar entregas em lote:', error);
      return sendActivityError(
        res,
        error,
        'Erro ao atualizar entregas em lote.'
      );
    }
  }
}

module.exports = new ClassActivityController();
