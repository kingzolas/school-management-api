const express = require('express');

const { verifyToken } = require('../middlewares/auth.middleware');
const { verifySchoolAccess } = require('../middlewares/schoolAccess.middleware');
const activityLibraryService = require('../services/activityLibrary.service');

const router = express.Router();

router.use(verifyToken, verifySchoolAccess);

router.get('/', async (req, res) => {
  try {
    const schoolId = req.user.school_id || req.user.schoolId;
    const result = await activityLibraryService.listSchoolLibrary(schoolId, req.query);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.status || error.statusCode || 500).json({
      message: error.message || 'Erro ao listar biblioteca de atividades.',
      code: error.code || 'SCHOOL_ACTIVITY_LIBRARY_ERROR',
    });
  }
});

module.exports = router;
