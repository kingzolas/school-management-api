// src/api/services/evaluation.service.js
const Evaluation = require('../models/evaluation.model');
const SchoolYearService = require('./schoolyear.service');

exports.createEvaluation = async (data, user) => {
    
    // --- INÍCIO DO DEBUG ---
    console.log('\n--- [DEBUG: createEvaluation] ---');
    console.log('Tentando acessar SchoolYearService...');
    console.log('Tipo do serviço:', typeof SchoolYearService);
    console.log('Conteúdo do serviço (Keys):', SchoolYearService ? Object.keys(SchoolYearService) : 'null');
    console.log('A função findTermByDate existe?', typeof SchoolYearService.findTermByDate === 'function' ? 'SIM' : 'NÃO');
    
    if (typeof SchoolYearService.findTermByDate !== 'function') {
        console.error('ERRO CRÍTICO: findTermByDate não foi encontrada. Verifique se há Dependência Circular ou se a função foi exportada no schoolyear.service.js');
    }
    console.log('---------------------------------\n');
    // --- FIM DO DEBUG ---

    // 1. Validar Data e Descobrir Bimestre
    // A mágica: O professor manda a data, o sistema decide o bimestre.
    const termInfo = await SchoolYearService.findTermByDate(data.schoolId, data.date);

    // 2. Montar o Objeto
    const evaluationData = {
        ...data,
        schoolYear: termInfo.schoolYearId,
        term: termInfo.termName, // "Trava" a avaliação neste bimestre
        teacher: user._id
    };

    // 3. Salvar
    const evaluation = await Evaluation.create(evaluationData);
    return evaluation;
};