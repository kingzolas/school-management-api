// src/api/utils/querySanitizer.js

// Lista de operadores de FILTRO perigosos
const DANGEROUS_FILTER_OPERATORS = [
  '$where', // Permite JS!
  '$function',
];

// Lista de estágios de AGregação perigosos (que escrevem/modificam dados)
const DANGEROUS_AGGREGATE_STAGES = [
  '$out',
  '$merge',
  '$set',
  '$unset',
  '$rename',
  '$replaceRoot',
  '$replaceWith',
  // $lookup pode ser perigoso para performance, mas vamos permitir por enquanto
];

/**
 * Sanitiza um objeto de FILTRO Mongoose.
 */
function sanitizeQuery(filterObject) {
  if (typeof filterObject !== 'object' || filterObject === null) {
    return filterObject;
  }
  if (Array.isArray(filterObject)) {
    return filterObject.map(sanitizeQuery);
  }
  for (const key of Object.keys(filterObject)) {
    if (DANGEROUS_FILTER_OPERATORS.includes(key)) {
      console.error(`[Sanitizer] Bloqueado operador de filtro perigoso: ${key}`);
      throw new Error(`Operação de filtro não permitida: ${key}`);
    }
    sanitizeQuery(filterObject[key]);
  }
  return filterObject;
}

/**
 * Sanitiza um PIPELINE de Agregação Mongoose.
 */
function sanitizeAggregation(pipeline) {
  if (!Array.isArray(pipeline)) {
    throw new Error('Pipeline de agregação deve ser um array.');
  }

  for (const stage of pipeline) {
    if (typeof stage !== 'object' || stage === null) {
      throw new Error('Estágio de pipeline inválido.');
    }
    
    const stageName = Object.keys(stage)[0];
    
    // 1. Verifica se o NOME do estágio é perigoso
    if (DANGEROUS_AGGREGATE_STAGES.includes(stageName)) {
      console.error(`[Sanitizer] Bloqueado estágio de agregação perigoso: ${stageName}`);
      throw new Error(`Estágio de agregação não permitido: ${stageName}`);
    }

    // 2. Sanitiza o CONTEÚDO de estágios seguros (como $match)
    if (stageName === '$match') {
      sanitizeQuery(stage[stageName]);
    }
  }
  return pipeline;
}

module.exports = { sanitizeQuery, sanitizeAggregation };