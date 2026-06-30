function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\u00ba|\u00aa|Âº|Âª/g, '')
    .replace(/(?<=\d)[oa]\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasEarlyChildhoodGrade(value) {
  const text = normalizeText(value);
  if (!text) return false;

  return (
    text.includes('maternal') ||
    /(^|\s)i periodo(\s|$)/.test(text) ||
    /(^|\s)ii periodo(\s|$)/.test(text) ||
    /(^|\s)1 periodo(\s|$)/.test(text) ||
    /(^|\s)2 periodo(\s|$)/.test(text) ||
    text.includes('primeiro periodo') ||
    text.includes('segundo periodo')
  );
}

function isEarlyChildhoodClass(classData = {}) {
  const reliableFields = [
    classData.level,
    classData.grade,
    classData.segment,
    classData.educationLevel,
    classData.education_level,
    classData.stage,
    classData.series,
    classData.classType,
    classData.class_type,
    classData.evaluationMode,
    classData.evaluation_mode,
  ];
  const settings = classData.scheduleSettings || {};

  if (settings.ensinoInfantil === true || settings.earlyChildhood === true) {
    return true;
  }

  const hasReliableField = reliableFields.some(
    (field) => normalizeText(field).length > 0
  );

  for (const field of reliableFields) {
    const text = normalizeText(field);
    if (!text) continue;
    if (
      text === 'educacao infantil' ||
      text === 'ensino infantil' ||
      text === 'infantil' ||
      text.includes('infantil') ||
      hasEarlyChildhoodGrade(text) ||
      text === 'developmental'
    ) {
      return true;
    }
  }

  if (hasReliableField) return false;

  return hasEarlyChildhoodGrade(classData.name);
}

function evaluationModeForClass(classData = {}) {
  return isEarlyChildhoodClass(classData) ? 'developmental' : 'numeric';
}

module.exports = {
  evaluationModeForClass,
  isEarlyChildhoodClass,
  normalizeText,
};
