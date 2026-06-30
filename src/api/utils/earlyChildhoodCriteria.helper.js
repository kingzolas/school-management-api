const DEFAULT_AREAS = [
  {
    areaId: 'early_language_portuguese',
    subjectName: 'Linguagem / Português',
    criteria: [
      {
        criterionId: 'language_oral_expression',
        description: 'Expressa ideias, sentimentos e necessidades oralmente.',
      },
      {
        criterionId: 'language_conversation_stories',
        description: 'Participa de rodas de conversa, histórias e músicas.',
      },
      {
        criterionId: 'language_own_name',
        description: 'Reconhece o próprio nome em diferentes contextos.',
      },
      {
        criterionId: 'language_letters_images',
        description: 'Demonstra interesse por letras, imagens e histórias.',
      },
    ],
  },
  {
    areaId: 'early_math',
    subjectName: 'Matemática',
    criteria: [
      {
        criterionId: 'math_colors_shapes_quantities',
        description:
          'Reconhece cores, formas, tamanhos e quantidades em situações do cotidiano.',
      },
      {
        criterionId: 'math_simple_counting',
        description: 'Realiza contagens simples com apoio.',
      },
      {
        criterionId: 'math_compare_objects',
        description: 'Compara objetos por tamanho, quantidade ou característica.',
      },
      {
        criterionId: 'math_logic_games',
        description: 'Participa de jogos e atividades de raciocínio lógico.',
      },
    ],
  },
  {
    areaId: 'early_nature_society',
    subjectName: 'Natureza e Sociedade',
    criteria: [
      {
        criterionId: 'nature_environment',
        description: 'Reconhece elementos do ambiente escolar e familiar.',
      },
      {
        criterionId: 'nature_self_care_belongings',
        description:
          'Demonstra cuidado com o próprio corpo, materiais e pertences.',
      },
      {
        criterionId: 'nature_social_interaction',
        description: 'Interage com colegas e adultos respeitando combinados.',
      },
      {
        criterionId: 'nature_family_environment',
        description:
          'Participa de atividades sobre natureza, família e convivência.',
      },
    ],
  },
  {
    areaId: 'early_art',
    subjectName: 'Arte',
    criteria: [
      {
        criterionId: 'art_painting_drawing_music',
        description:
          'Participa de atividades com pintura, desenho, colagem, música e movimento.',
      },
      {
        criterionId: 'art_materials_textures',
        description: 'Explora diferentes materiais, cores e texturas.',
      },
      {
        criterionId: 'art_fine_motor',
        description: 'Desenvolve coordenação motora fina em atividades manuais.',
      },
      {
        criterionId: 'art_creativity',
        description: 'Expressa criatividade em produções artísticas.',
      },
    ],
  },
  {
    areaId: 'early_values_religion',
    subjectName: 'Ensino Religioso / Valores',
    criteria: [
      {
        criterionId: 'values_reflection_prayer',
        description:
          'Participa de momentos de reflexão, oração ou conversa sobre valores.',
      },
      {
        criterionId: 'values_respect_care_sharing',
        description: 'Demonstra atitudes de respeito, cuidado e partilha.',
      },
      {
        criterionId: 'values_classroom_agreements',
        description: 'Reconhece combinados de convivência.',
      },
      {
        criterionId: 'values_positive_interaction',
        description: 'Interage positivamente com colegas e professores.',
      },
    ],
  },
];

function getDefaultEarlyChildhoodAreas() {
  return DEFAULT_AREAS.map((area) => ({
    ...area,
    criteria: area.criteria.map((criterion) => ({ ...criterion })),
  }));
}

function isDefaultEarlyChildhoodAreaId(areaId) {
  return DEFAULT_AREAS.some((area) => area.areaId === String(areaId || ''));
}

function getDefaultEarlyChildhoodArea(areaId) {
  return getDefaultEarlyChildhoodAreas().find(
    (area) => area.areaId === String(areaId || '')
  );
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCriteriaForSubjectName(subjectName) {
  const normalized = normalizeText(subjectName);
  if (normalized.includes('matemat')) {
    return getDefaultEarlyChildhoodArea('early_math').criteria;
  }
  if (normalized.includes('natureza') || normalized.includes('sociedade')) {
    return getDefaultEarlyChildhoodArea('early_nature_society').criteria;
  }
  if (normalized.includes('arte') || normalized.includes('musica')) {
    return getDefaultEarlyChildhoodArea('early_art').criteria;
  }
  if (normalized.includes('relig') || normalized.includes('valor')) {
    return getDefaultEarlyChildhoodArea('early_values_religion').criteria;
  }
  return getDefaultEarlyChildhoodArea('early_language_portuguese').criteria;
}

module.exports = {
  getDefaultEarlyChildhoodAreas,
  getDefaultEarlyChildhoodArea,
  getCriteriaForSubjectName,
  isDefaultEarlyChildhoodAreaId,
};
