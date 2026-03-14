// src/api/controllers/gemini-exam.controller.js

const geminiExamService = require('../services/gemini-exam.service');

exports.generateQuestions = async (req, res) => {
  try {
    const { topic, count, gradeLevel, type } = req.body;

    // Validação básica
    if (!topic || !gradeLevel) {
      return res.status(400).json({
        success: false,
        message: "Os campos 'topic' (tema) e 'gradeLevel' (série/ano) são obrigatórios."
      });
    }

    // Chama o serviço passando os parâmetros (com valores default caso falte algo)
    const questions = await geminiExamService.generateQuestions({
      topic,
      count: parseInt(count) || 5,
      gradeLevel,
      type: type || 'OBJECTIVE'
    });

    return res.status(200).json({
      success: true,
      data: questions
    });

  } catch (error) {
    console.error('❌ Erro no GeminiExamController:', error);
    return res.status(500).json({
      success: false,
      message: 'Ocorreu um erro interno ao tentar gerar as questões.',
      error: error.message
    });
  }
};