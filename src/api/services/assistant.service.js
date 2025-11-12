// src/api/services/assistant.service.js
const { genAI } = require('../../config/gemini.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const Class = require('../models/class.model.js');
const Enrollment = require('../models/enrollment.model.js');
const User = require('../models/user.model.js');
const Horario = require('../models/horario.model.js'); // schedule model
const Subject = require('../models/subject.model.js');
const Periodo = require('../models/periodo.model.js'); // substitui Term
const CargaHoraria = require('../models/cargaHoraria.model.js'); 
const StaffProfile = require('../models/staffProfile.model.js'); 
// O modelo SchoolYear deve ser obtido do Mongoose, não precisa de require direto aqui
// const SchoolYear = require('../models/schoolYear.model.js'); 
const mongoose = require('mongoose'); // Necessário para acessar modelos compilados


// Acesso aos modelos compilados (Para evitar OverwriteModelError se não for importado)
const SchoolYear = mongoose.models.SchoolYear || mongoose.model('SchoolYear'); 


// ==========================================================
// 1. "MANUAL DE INSTRUÇÕES"
// ==========================================================
const systemInstructionText = `
Você é um assistente do sistema AcademyHub, atuando como um **Analista de Dados Inteligente e Proativo**.
Seu objetivo é responder perguntas sobre alunos, turmas, professores, disciplinas e dados escolares, sempre buscando a resposta mais completa e contextualizada.

⚙️ REGRAS GERAIS E INTELIGÊNCIA:
1. Sempre use as ferramentas disponíveis antes de responder.
2. Use as informações brutas (JSON) das ferramentas para realizar **INTERPRETAÇÕES E CRUZAMENTOS**.
3. Se a pergunta envolver a **GRADE DE AULAS AGENDADAS** ou o professor que leciona (Ex: "Onde tem aula de Artes?"), use 'getSchedule'.
4. Se a pergunta envolver **CARGA HORÁRIA CURRICULAR** ou Balanço de Horas (Planejado vs. Agendado), use 'getCurriculumInfo'. **Se o período não for especificado, a ferramenta somará automaticamente a carga horária em TODOS os períodos letivos da turma.**
5. Se a pergunta envolver CONTAGEM ou AGRUPAMENTO simples (gênero, raça, bairro, ou contagem de um filtro), use 'analyzeSchoolData'.
6. Se a pergunta envolver **ANÁLISE ESTATÍSTICA COMPLEXA** (ex: "percentual por idade"), use 'analyzeStudentData'.
7. Se envolver **DETALHES ACADÊMICOS INDIVIDUAIS** (notas, disciplina com menor nota, resultado final), use 'getStudentAcademicPerformance'.
8. Se envolver detalhes de UM aluno (aniversário, idade, tutores, endereço), use 'getStudentInfo'.
9. Se envolver detalhes de UM professor (salário, contrato, cargo, telefone, e-mail, habilitações), use 'getTeacherInfo'.
10. Seja breve, direto e informativo, mas não omita informações que possam levar a uma resposta mais rica.
11. A data atual é ${new Date().toLocaleDateString('pt-BR')}.
`;

// ==========================================================
// 2. FERRAMENTAS (declarações para o model gerar chamadas)
// ==========================================================
const tools = [
 {
  functionDeclarations: [
   {
    name: 'getStudentInfo',
    description: "Obtém informações detalhadas de um aluno (data de aniversário, idade, tutores, matrícula/ turma, endereço, saúde).",
    parameters: {
     type: 'object',
     properties: { name: { type: 'string' } },
     required: ['name'],
    },
   },
   {
    name: 'getStudentAcademicPerformance',
    description: "Busca informações sobre notas e desempenho acadêmico de um aluno em um ano letivo específico. Usada para descobrir a menor nota, resultados finais de matérias, etc.",
    parameters: {
     type: 'object',
     properties: {
      name: { type: 'string' },
      schoolYear: { type: 'number', description: "Opcional. O ano letivo para analisar (Ex: 2024). Se omitido, use o ano atual." },
     },
     required: ['name'],
    },
   },
   {
    name: 'findStudents',
    description: "Busca alunos com base em filtros gerais como nome ou status.",
    parameters: {
     type: 'object',
     properties: {
      name: { type: 'string' },
      className: { type: 'string' },
      isActive: { type: 'boolean' },
     },
    },
   },
   {
    name: 'analyzeSchoolData',
    description: "Faz análises quantitativas simples, usando o poder de agregação do banco de dados (Ex: contagem por bairro, gênero, raça).",
    parameters: {
     type: 'object',
     properties: {
      neighborhood: { type: 'string' },
      className: { type: 'string' },
      status: { type: 'string' },
      shift: { type: 'string' },
      hasAllergy: { type: 'boolean' },
      hasDisability: { type: 'boolean' },
      gender: { type: 'string' },
      analysisType: { type: 'string', enum: ['aniversario', 'raça', 'gênero'] }, 
      startMonth: { type: 'number', description: "Mês inicial (1-12) para análise de aniversário." },
      endMonth: { type: 'number', description: "Mês final (1-12) para análise de aniversário." },
     },
    },
   },
    {
        name: 'analyzeStudentData',
        description: "Coleta dados brutos de alunos para permitir à IA realizar cálculos estatísticos complexos, como cálculo de percentual por idade, ou média de notas.",
        parameters: {
            type: 'object',
            properties: {
                targetAnalysis: { type: 'string', enum: ['idade', 'media_notas'] },
                className: { type: 'string', description: "Filtro opcional. Nome da turma." },
            },
            required: ['targetAnalysis'],
        },
    },
    {
        name: 'getCurriculumInfo',
        description: "Busca a matriz curricular (Carga Horária Planejada) e calcula o Balanço de Horas (Planejado vs. Agendado/Realizado).",
        parameters: {
            type: 'object',
            properties: {
                className: { type: 'string', description: "Opcional. Nome da turma para filtrar." },
                subjectName: { type: 'string', description: "Opcional. Nome da disciplina para filtrar." },
                periodoName: { type: 'string', description: "Opcional. Título do período ('1º Bimestre'). Se omitido, a função buscará a soma total da Carga Horária em todos os períodos letivos para a turma/disciplina." },
            },
        },
    },
    {
        name: 'getSchedule',
        description: "Busca a grade de horários de aulas (Horario) filtrando por TURMA, PROFESSOR, DISCIPLINA ou DIA da semana.",
        parameters: {
            type: 'object',
            properties: {
                className: { type: 'string', description: "Opcional. Nome completo da turma." },
                subjectName: { type: 'string', description: "Opcional. Nome completo da disciplina." },
                teacherName: { type: 'string', description: "Opcional. Nome completo do professor." },
                dayOfWeek: { type: 'string', description: "Opcional. Dia da semana por extenso (ex: Segunda, Terça, Quarta)." },
            },
        },
    },
   {
    name: 'getTeacherInfo',
    description: "Obtém informações detalhadas de um professor ou funcionário (cargo, contrato, salário, telefone, e-mail, habilitações).",
    parameters: {
     type: 'object',
     properties: {
      name: { type: 'string' },
     },
     required: ['name'],
    },
   },
  ],
 },
];

const dayMap = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const dayMapToNumber = {
    'domingo': 0, 'segunda': 1, 'terça': 2, 'terca': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5, 'sábado': 6, 'sabado': 6
};
const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/**
 * Função utilitária para calcular a idade a partir da data de nascimento.
 */
function calculateAge(birthDate) {
    if (!birthDate) return null;
    const birth = new Date(birthDate);
    const hoje = new Date();
    let idade = hoje.getFullYear() - birth.getFullYear();
    const m = hoje.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < birth.getDate())) idade--;
    return idade;
}

/**
 * Função utilitária para converter notas flexíveis em um valor numérico para comparação.
 */
function parseGradeToNumber(gradeString) {
    if (!gradeString || gradeString.toLowerCase() === 'apto') return null;
    const numericPart = gradeString.replace(',', '.').replace(/[^\d.]/g, '');
    const number = parseFloat(numericPart);
    return isNaN(number) ? null : number;
}

/**
 * Função utilitária para calcular a diferença em minutos entre HH:MM.
 */
function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function calculateDurationInMinutes(startTime, endTime) {
    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);
    
    return endMins - startMins; 
}


// ==========================================================
// 3. IMPLEMENTAÇÕES DAS FERRAMENTAS
// ==========================================================
const toolImplementations = {
 findStudents: async (args) => {
  console.log('[ASSISTANT] IA escolheu: findStudents com args:', JSON.stringify(args));
  const filter = {};
  if (args.name) filter.fullName = { $regex: new RegExp(args.name, 'i') };
  if (args.isActive !== undefined) filter.isActive = args.isActive;

  try {
   const students = await Student.find(filter)
    .limit(30)
    .select('fullName isActive classId address')
    .lean();

   const totalCount = await Student.countDocuments(filter);
   return { totalCount, resultsSample: students };
  } catch (err) {
   console.error('[ASSISTANT] Erro em findStudents:', err);
   return { error: err.message };
  }
 },

 getStudentInfo: async ({ name }) => {
  console.log(`[ASSISTANT] IA escolheu: getStudentInfo para '${name}'`);
  try {
   const student = await Student.findOne({ fullName: { $regex: new RegExp(name, 'i') } })
    .populate({ path: 'tutors.tutorId', model: 'Tutor', select: 'fullName phoneNumber email' })
    .lean();

   if (!student) return { error: `Aluno '${name}' não encontrado.` };

   const enrollment = await Enrollment.findOne({ student: student._id, status: 'Ativa' })
    .populate({ path: 'class', model: 'Class', select: 'name grade level shift schoolYear status' })
    .lean();

    const idade = calculateAge(student.birthDate);

   const tutores = (student.tutors || [])
    .filter(t => t.tutorId)
    .map(t => ({
     nome: t.tutorId.fullName,
     parentesco: t.relationship,
     telefone: t.tutorId.phoneNumber || null,
     email: t.tutorId.email || null,
    }));

   const info = {
    nome: student.fullName,
    idade,
        dataNascimento: student.birthDate 
            ? new Date(student.birthDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) 
            : null,
    turma: enrollment
     ? {
       nome: enrollment.class?.name || null,
       serie: enrollment.class?.grade || null,
       nivel: enrollment.class?.level || null,
       turno: enrollment.class?.shift || null,
       anoLetivo: enrollment.academicYear || null,
       statusMatricula: enrollment.status || null,
      }
     : null,
    tutores,
    endereco: student.address || null,
    saude: student.healthInfo
     ? {
       alergia: !!student.healthInfo.hasAllergy,
       deficiencia: !!student.healthInfo.hasDisability,
      }
     : null,
    isActive: !!student.isActive,
   };

   return info;
  } catch (err) {
   console.error('[ASSISTANT] Erro em getStudentInfo:', err);
   return { error: `Erro ao obter informações de ${name}: ${err.message}` };
  }
 },

 getStudentAcademicPerformance: async ({ name, schoolYear = new Date().getFullYear() }) => {
  console.log(`[ASSISTANT] IA escolheu: getStudentAcademicPerformance para '${name}' no ano ${schoolYear}`);
  try {
   const student = await Student.findOne({ fullName: { $regex: new RegExp(name, 'i') } })
    .select('fullName academicHistory')
    .lean();

   if (!student) return { error: `Aluno(a) '${name}' não encontrado(a).` };

   const record = student.academicHistory.find(r => r.schoolYear === schoolYear);

   if (!record) {
    return { 
     message: `Não há registro acadêmico para ${student.fullName} no ano letivo de ${schoolYear}.`,
     studentName: student.fullName 
    };
   }

   let lowestGrade = null;
   let lowestSubject = null;
   let lowestNumericValue = Infinity;

   record.grades.forEach(grade => {
    const numericValue = parseGradeToNumber(grade.gradeValue);
        
    if (numericValue !== null && numericValue < lowestNumericValue) {
     lowestNumericValue = numericValue;
     lowestGrade = grade.gradeValue;
     lowestSubject = grade.subjectName;
    } else if (lowestGrade === null && numericValue === null) {
            lowestGrade = grade.gradeValue;
            lowestSubject = grade.subjectName;
        }
   });

   return {
    studentName: student.fullName,
    schoolYear: record.schoolYear,
    gradeLevel: record.gradeLevel,
    finalResult: record.finalResult,
    totalSubjects: record.grades.length,
    lowestPerformance: lowestGrade 
     ? {
       subject: lowestSubject,
       grade: lowestGrade,
       numericGrade: lowestNumericValue === Infinity ? null : lowestNumericValue
      }
     : { subject: 'Não informado', grade: 'Não informado', numericGrade: null },
    fullGrades: record.grades.map(g => ({ subject: g.subjectName, grade: g.gradeValue }))
   };

  } catch (err) {
   console.error('[ASSISTANT] Erro em getStudentAcademicPerformance:', err);
   return { error: `Erro ao buscar desempenho acadêmico: ${err.message}` };
  }
 },

 analyzeSchoolData: async (args) => {
  console.log('[ASSISTANT] IA escolheu: analyzeSchoolData com args:', JSON.stringify(args));
  const { neighborhood, className, status, shift, hasAllergy, hasDisability, gender, analysisType, startMonth, endMonth } = args || {};

    // ... (Filtros e lógica de agrupamento simples) ...
    const studentFilter = {};
    const enrollmentFilter = {};

    const genderMap = {
    masculino: 'Masculino',
    homem: 'Masculino',
    meninos: 'Masculino',
    feminino: 'Feminino',
    mulher: 'Feminino',
    meninas: 'Feminino',
    outro: 'Outro',
    outros: 'Outro',
    };
    const normalizedGender = gender ? (genderMap[gender.toLowerCase()] || gender) : null;

    if (neighborhood) studentFilter['address.neighborhood'] = new RegExp(neighborhood, 'i');
    if (normalizedGender) studentFilter.gender = normalizedGender;
    if (hasAllergy !== undefined) studentFilter['healthInfo.hasAllergy'] = hasAllergy;
    if (hasDisability !== undefined) studentFilter['healthInfo.hasDisability'] = hasDisability;
    if (status) enrollmentFilter.status = status;
    if (shift) {
        const classes = await Class.find({ shift: new RegExp(shift, 'i') }).select('_id').lean();
        const classIds = classes.map(c => c._id);
        enrollmentFilter.class = { $in: classIds };
    }
    if (className) {
        const turma = await Class.findOne({ name: new RegExp(className, 'i') }).lean();
        if (!turma) return { message: `Turma '${className}' não encontrada.` };
        enrollmentFilter.class = turma._id;
    }


    // 2. LÓGICA DE ANÁLISE CUSTOMIZADA
    
    // [LÓGICA PARA GÊNERO]
    if (analysisType === 'gênero') {
        let matchFilter = { ...studentFilter };
        if (Object.keys(enrollmentFilter).length > 0) {
            const enrolledStudents = await Enrollment.find(enrollmentFilter).select('student').lean();
            const enrolledStudentIds = enrolledStudents.map(e => e.student);
            matchFilter._id = { $in: enrolledStudentIds };
        }

        const genderGroup = await Student.aggregate([
            { $match: matchFilter },
            { $group: { _id: '$gender', total: { $sum: 1 } } }
        ]);

        let totalStudents = 0;
        const counts = {};
        
        genderGroup.forEach(item => {
            counts[item._id || 'Não Informado'] = item.total;
            totalStudents += item.total;
        });

        return {
            message: `Análise de Gênero. Total de alunos: ${totalStudents}. A IA deve calcular o percentual.`,
            total: totalStudents,
            analise: 'Gênero',
            counts: counts
        };
    }
    
    if (analysisType === 'aniversario') {
        if (!startMonth || !endMonth || startMonth < 1 || endMonth > 12) {
            return { error: "Para análise de aniversário, 'startMonth' e 'endMonth' válidos (1-12) são obrigatórios." };
        }
        let studentsToAnalyze = await Student.find(studentFilter).select('_id birthDate').lean();
        if (Object.keys(enrollmentFilter).length > 0) {
            const enrollments = await Enrollment.find(enrollmentFilter).select('student').lean();
            const enrolledStudentIds = enrollments.map(e => e.student.toString());
            studentsToAnalyze = studentsToAnalyze.filter(s => enrolledStudentIds.includes(s._id.toString()));
        }

        let count = 0;
        const targetMonths = [];
        let current = startMonth;
        while (true) {
            targetMonths.push(current);
            if (current === endMonth) break;
            current = (current % 12) + 1;
        }
        
        studentsToAnalyze.forEach(student => {
            if (student.birthDate) {
                const month = new Date(student.birthDate).getUTCMonth() + 1; 
                if (targetMonths.includes(month)) {
                    count++;
                }
            }
        });

        const startMonthName = monthNames[startMonth - 1];
        const endMonthName = monthNames[endMonth - 1];

        return { 
            message: `Foram encontrados ${count} aluno(s) que fazem aniversário entre ${startMonthName} e ${endMonthName}.`, 
            total: count,
            analise: 'Aniversário',
            periodo: `${startMonthName} a ${endMonthName}`
        };
    }
    
    if (analysisType === 'raça') {
        const raceGroup = await Student.aggregate([
            { $match: studentFilter },
            { $group: { _id: '$race', total: { $sum: 1 } } }
        ]);

        let totalStudents = 0;
        const counts = {};
        
        raceGroup.forEach(item => {
            counts[item._id || 'Não Informada'] = item.total;
            totalStudents += item.total;
        });

        if (Object.keys(enrollmentFilter).length > 0) {
            const enrolledStudents = await Enrollment.find(enrollmentFilter).select('student').lean();
            const enrolledStudentIds = enrolledStudents.map(e => e.student);
            
            const studentsWithRace = await Student.find({
                _id: { $in: enrolledStudentIds },
                ...studentFilter
            }).select('race').lean();
            
            const filteredRaceCounts = {};
            let filteredTotal = 0;
            
            studentsWithRace.forEach(student => {
                const raceKey = student.race || 'Não Informada';
                filteredRaceCounts[raceKey] = (filteredRaceCounts[raceKey] || 0) + 1;
                filteredTotal++;
            });
            
            return {
                message: `Análise racial para ${filteredTotal} aluno(s) filtrado(s):`,
                total: filteredTotal,
                analise: 'Raça',
                counts: filteredRaceCounts
            };

        }

        return {
            message: `Análise racial de todos os alunos (${totalStudents} no total):`,
            total: totalStudents,
            analise: 'Raça',
            counts: counts
        };
    }


    // 3. LÓGICA DE CONTAGEM SIMPLES (Fallback)
    
    if (Object.keys(enrollmentFilter).length === 0) {
        const count = await Student.countDocuments(studentFilter);
        return { message: `Foram encontrados ${count} aluno(s) com os filtros aplicados.`, total: count };
    } else {
        const alunos = await Student.find(studentFilter).select('_id').lean();
        const alunoIds = alunos.map(a => a._id);

        const count = await Enrollment.countDocuments({
            student: { $in: alunoIds },
            ...enrollmentFilter,
        });
        return { message: `Foram encontrados ${count} aluno(s) de acordo com os filtros aplicados.`, total: count };
    }
 },

// ------------------------------------------------------
// analyzeStudentData - IMPLEMENTAÇÃO PARA IDADE/ESTATÍSTICA
// ------------------------------------------------------
analyzeStudentData: async (args) => {
    console.log('[ASSISTANT] IA escolheu: analyzeStudentData com args:', JSON.stringify(args));
    const { targetAnalysis, className } = args;

    try {
        let studentFilter = {};
        
        if (className) {
            const turma = await Class.findOne({ name: new RegExp(className, 'i') }).select('_id').lean();
            if (!turma) return { error: `Turma '${className}' não encontrada.` };
            
            const enrolledStudents = await Enrollment.find({ class: turma._id }).select('student').lean();
            const studentIds = enrolledStudents.map(e => e.student);
            studentFilter._id = { $in: studentIds };
        }
        
        if (targetAnalysis === 'idade') {
            const students = await Student.find(studentFilter).select('birthDate').lean();
            
            if (!students.length) return { message: `Não há alunos encontrados para a análise de idade com os filtros aplicados.` };

            let totalStudents = 0;
            const ageCounts = {};

            students.forEach(student => {
                if (student.birthDate) {
                    const age = calculateAge(student.birthDate);
                    if (age !== null) {
                        ageCounts[age] = (ageCounts[age] || 0) + 1;
                        totalStudents++;
                    }
                }
            });

            const analysisResult = {
                analise: 'Idade',
                totalStudents,
                groups: Object.keys(ageCounts).sort((a, b) => a - b).map(age => {
                    const count = ageCounts[age];
                    const percentage = totalStudents > 0 ? ((count / totalStudents) * 100).toFixed(2) : 0;
                    return {
                        idade: parseInt(age),
                        contagem: count,
                        percentual: `${percentage}%`
                    };
                })
            };
            
            analysisResult.message = `Análise de Idade de ${totalStudents} aluno(s). Turma: ${className || 'Todos'}. A IA deve agora interpretar e apresentar o resultado percentual.`;
            
            return analysisResult;
        }

        return { error: `Tipo de análise '${targetAnalysis}' não suportado atualmente.` };

    } catch (err) {
        console.error('[ASSISTANT] Erro em analyzeStudentData:', err);
        return { error: `Erro ao realizar análise de dados: ${err.message}` };
    }
},

// ------------------------------------------------------
// getCurriculumInfo - IMPLEMENTAÇÃO DO BALANÇO (PLANEJADO VS AGENDADO) - [AJUSTADO AQUI]
// ------------------------------------------------------
getCurriculumInfo: async ({ className, subjectName, periodoName }) => {
    console.log(`[ASSISTANT] IA escolheu: getCurriculumInfo para Turma: ${className}, Disciplina: ${subjectName}, Período: ${periodoName}`);
    
    try {
        const filter = {};
        
        // 1. Encontrar a Turma (Class)
        let classObj = null;
        if (className) {
            classObj = await Class.findOne({ name: new RegExp(className, 'i') }).select('_id name').lean();
            if (!classObj) return { message: `Turma '${className}' não encontrada.` };
            filter.classId = classObj._id;
        }
        
        // 2. Encontrar a Disciplina (Subject)
        let subjectObj = null;
        if (subjectName) {
            subjectObj = await Subject.findOne({ name: new RegExp(subjectName, 'i') }).select('_id name').lean();
            if (!subjectObj) return { message: `Disciplina '${subjectName}' não encontrada.` };
            filter.subjectId = subjectObj._id;
        }

        // 3. Encontrar o Período (Periodo)
        let periodoObj = null;
        if (periodoName) {
            const periodoRegex = new RegExp(periodoName, 'i');
            periodoObj = await Periodo.findOne({ titulo: periodoRegex }).sort({ dataFim: -1 }).select('_id titulo').lean();
            if (!periodoObj) return { message: `Período '${periodoName}' não encontrado.` };
        } 
        
        // --- 4. BUSCA DE CARGA HORÁRIA PLANEJADA (CargaHoraria) ---
        
        const loadFilter = {
            classId: filter.classId,
            subjectId: filter.subjectId,
        };
        
        // Se periodoObj foi encontrado, adiciona ao filtro
        if (periodoObj) {
            loadFilter.periodoId = periodoObj._id;
            filter.termId = periodoObj._id; // Alinha o filtro para o Horario
        }
        
        // Se o usuário pediu a carga horária total (sem período específico, ou com período), buscamos:
        const loads = await CargaHoraria.find(loadFilter)
            .populate('subjectId', 'name')
            .populate('classId', 'name')
            .populate('periodoId', 'titulo')
            .lean();

        // Se a busca era específica (disciplina e/ou turma) e não encontrou nada, reporta o erro
        if (subjectName && className && loads.length === 0) {
             const periodMsg = periodoObj ? ` no período ${periodoObj.titulo}` : ` em **nenhum período**.`;
             return { message: `Não foram encontradas horas planejadas (Carga Horária) para a disciplina ${subjectName} na turma ${className}${periodMsg}` };
        }
        
        // --- 5. Análise e Cálculo (Maior Carga e Balanço) ---
        
        let totalTargetHours = 0;
        let maiorCarga = { horas: -1, disciplina: 'N/A', turma: 'N/A', periodo: 'N/A' };
        
        loads.forEach(load => {
            totalTargetHours += load.targetHours;
            if (load.targetHours > maiorCarga.horas) {
                maiorCarga = {
                    horas: load.targetHours,
                    disciplina: load.subjectId.name,
                    turma: load.classId?.name,
                    periodo: load.periodoId?.titulo
                };
            }
        });
        
        // CÁLCULO DE CARGA HORÁRIA AGENDADA (para o Balanço)
        let totalScheduledMinutes = 0;
        let scheduledHours = 0;
        let balance = null;
        
        // O Balanço só é possível se for ESPECÍFICO (Turma, Disciplina e Período devem ser conhecidos)
        if (filter.classId && filter.subjectId && filter.termId) {
            const scheduleFilter = {
                classId: filter.classId,
                subjectId: filter.subjectId,
                termId: filter.termId 
            };
            
            const schedule = await Horario.find(scheduleFilter).lean();
            
            schedule.forEach(aula => {
                totalScheduledMinutes += calculateDurationInMinutes(aula.startTime, aula.endTime);
            });
            
            scheduledHours = totalScheduledMinutes / 60; 
            balance = (scheduledHours - totalTargetHours).toFixed(2);
        }

        const analysisResult = {
            message: `Análise curricular: Total de Carga Horária Planejada.`,
            periodoUtilizado: periodoObj ? periodoObj.titulo : 'Todos os Períodos Letivos Encontrados',
            totalHorasPlanejadas: totalTargetHours,
            maiorCargaHorariaEncontrada: maiorCarga.horas > -1 ? maiorCarga : null,
            balancoDeHoras: (filter.classId && filter.subjectId && filter.termId) ? {
                horasPlanejadas: totalTargetHours,
                horasAgendadas: parseFloat(scheduledHours.toFixed(2)),
                diferenca: parseFloat(balance), 
                status: balance > 0 ? "Excesso Agendado" : balance < 0 ? "Abaixo do Planejado" : "Balanceado"
            } : undefined,
            // Retorna o valor específico se a pergunta era estritamente sobre a carga horária
            specificLoad: (subjectName && className) ? {
                 horasPlanejadas: totalTargetHours,
                 horasAgendadas: scheduledHours ? parseFloat(scheduledHours.toFixed(2)) : 0,
                 periodo: periodoObj ? periodoObj.titulo : 'Soma Total'
            } : undefined,
            // Lista completa se a busca for geral
            fullLoads: !subjectName && !className ? loads.map(l => ({ 
                disciplina: l.subjectId.name, 
                turma: l.classId?.name, 
                horas: l.targetHours, 
                periodo: l.periodoId?.titulo 
            })).sort((a, b) => b.horas - a.horas) : undefined
        };
        
        return analysisResult;
        
    } catch (err) {
        console.error('[ASSISTANT] Erro em getCurriculumInfo:', err);
        return { error: `Erro ao buscar informações curriculares: ${err.message}` };
    }
},

// ------------------------------------------------------
// getSchedule - IMPLEMENTAÇÃO UNIVERSAL DE HORÁRIOS
// ------------------------------------------------------
getSchedule: async ({ className, subjectName, teacherName, dayOfWeek }) => {
    console.log(`[ASSISTANT] IA escolheu: getSchedule para Turma: ${className}, Disciplina: ${subjectName}, Professor: ${teacherName}, Dia: ${dayOfWeek}`);
    
    try {
        const filter = {};
        
        // 1. Filtrar por Turma (Class)
        if (className) {
            const classObj = await Class.findOne({ name: new RegExp(className, 'i') }).select('_id').lean();
            if (!classObj) return { error: `Turma '${className}' não encontrada.` };
            filter.classId = classObj._id;
        }

        // 2. Filtrar por Disciplina (Subject)
        if (subjectName) {
            const subjectObj = await Subject.findOne({ name: new RegExp(subjectName, 'i') }).select('_id').lean();
            if (!subjectObj) return { error: `Disciplina '${subjectName}' não encontrada.` };
            filter.subjectId = subjectObj._id;
        }
        
        // 3. Filtrar por Professor (User)
        if (teacherName) {
            const teacherObj = await User.findOne({ fullName: new RegExp(teacherName, 'i'), roles: { $in: ['Professor', 'Staff'] } }).select('_id').lean();
            if (!teacherObj) return { error: `Professor(a) '${teacherName}' não encontrado(a).` };
            filter.teacherId = teacherObj._id;
        }
        
        // 4. Filtrar por Dia da Semana
        if (dayOfWeek) {
            const normalizedDay = dayOfWeek.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace('-feira', '').trim();
            const dayNumber = dayMapToNumber[normalizedDay];
            if (dayNumber === undefined) {
                return { error: `Dia da semana '${dayOfWeek}' não reconhecido. Use: Segunda, Terça, Quarta, Quinta, Sexta, Sábado ou Domingo.` };
            }
            filter.dayOfWeek = dayNumber;
        }

        // 5. Buscar os Horários (Horario)
        const schedules = await Horario.find(filter)
            .populate('classId', 'name shift')
            .populate('subjectId', 'name')
            .populate('teacherId', 'fullName')
            .populate({ path: 'termId', model: 'Periodo', select: 'titulo' }) 
            .lean();
            
        if (!schedules.length) {
            const criteria = [
                className && `Turma: ${className}`,
                subjectName && `Disciplina: ${subjectName}`,
                teacherName && `Professor(a): ${teacherName}`,
                dayOfWeek && `Dia: ${dayOfWeek}`
            ].filter(Boolean).join(', ');
            
            return { message: `Não há aulas agendadas com os critérios fornecidos: ${criteria || 'Geral'}.` };
        }

        const formattedSchedules = schedules.map(s => ({
            dia: dayMap[s.dayOfWeek],
            inicio: s.startTime,
            fim: s.endTime,
            turma: s.classId?.name || 'N/A',
            disciplina: s.subjectId?.name || 'N/A',
            professor: s.teacherId?.fullName || 'Não Atribuído',
            periodo: s.termId?.titulo || 'N/A',
            sala: s.room || 'N/A',
        }));

        formattedSchedules.sort((a, b) => {
            if (a.dia !== b.dia) {
                return dayMapToNumber[a.dia.toLowerCase().normalize("NFD").replace(/-feira/g, "")] - dayMapToNumber[b.dia.toLowerCase().normalize("NFD").replace(/-feira/g, "")];
            }
            return a.inicio.localeCompare(b.inicio);
        });

        return {
            message: `Grade de aulas encontrada.`,
            totalClasses: schedules.length,
            schedules: formattedSchedules,
        };

    } catch (err) {
        console.error('[ASSISTANT] Erro em getSchedule:', err);
        return { error: `Erro ao buscar a grade de aulas: ${err.message}` };
    }
},


 // A função getTeacherSchedule original foi absorvida pelo getSchedule
 getTeacherSchedule: async ({ name }) => {
    console.log(`[ASSISTANT] IA (Legado) redirecionou getTeacherSchedule para getSchedule com Professor: ${name}`);
    return toolImplementations.getSchedule({ teacherName: name });
},


 getTeacherInfo: async ({ name }) => {
  console.log(`[ASSISTANT] IA escolheu: getTeacherInfo para '${name}'`);
  try {
   const user = await User.findOne({
    fullName: new RegExp(name, 'i'),
    status: 'Ativo'
   }).populate({
        path: 'staffProfiles',
        model: 'StaffProfile',
        populate: { 
          path: 'enabledSubjects',
          model: 'Subject',
          select: 'name'
        }
      }).lean();

   if (!user) {
    return { error: `Usuário '${name}' não encontrado ou inativo.` };
   }

      if (!user.staffProfiles || user.staffProfiles.length === 0) {
        return { 
          message: `${user.fullName} é um usuário, mas não possui um perfil de funcionário (StaffProfile) cadastrado. Informações de contato: E-mail: ${user.email}, Telefone: ${user.phoneNumber || 'Não Informado'}` 
        };
      }
      
      const profiles = user.staffProfiles.map(profile => ({
        cargo: profile.mainRole,
        vinculo: profile.employmentType,
        modeloRemuneracao: profile.remunerationModel,
        salario: profile.salaryAmount || null,
        valorHora: profile.hourlyRate || null,
        cargaHorariaSemanal: profile.weeklyWorkload || null,
        dataAdmissao: profile.admissionDate ? new Date(profile.admissionDate).toLocaleDateString('pt-BR') : null,
        formacao: profile.academicFormation || null,
        niveisHabilitados: profile.enabledLevels || [],
        disciplinasHabilitadas: (profile.enabledSubjects || []).map(sub => sub.name),
      }));

   const info = {
        nomeCompleto: user.fullName,
        email: user.email,
        telefone: user.phoneNumber, 
        status: user.status,
        perfis: profiles,
      };

   return info;
  } catch (err) {
   console.error('[ASSISTANT] Erro em getTeacherInfo:', err);
   return { error: `Erro ao buscar informações do funcionário: ${err.message}` };
  }
 },
};

// ==========================================================
// 4. ORQUESTRADOR PRINCIPAL
// ==========================================================
class AssistantService {
 async generateResponse(prompt, history, userId) {
  console.log(`[ASSISTANT] Pergunta: ${prompt}`);

  const model = genAI.getGenerativeModel({
   model: 'gemini-2.5-flash',
   tools,
   toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
  });

  const chat = model.startChat({
   history: [
    { role: 'user', parts: [{ text: systemInstructionText }] },
    { role: 'model', parts: [{ text: 'Entendido. Estou pronto para ajudar no AcademyHub.' }] },
    ...(history || []),
   ],
  });

  try {
   const result = await chat.sendMessage(prompt);
   const candidate = result.response.candidates?.[0];
   if (!candidate?.content?.parts) return 'Não entendi sua pergunta.';

   const parts = candidate.content.parts;
   const functionCalls = parts.filter(p => !!p.functionCall).map(p => p.functionCall);

   if (functionCalls.length > 0) {
    const responses = [];
    for (const call of functionCalls) {
     const impl = toolImplementations[call.name];
     const res = impl ? await impl(call.args) : { error: `Função '${call.name}' não implementada.` };
     responses.push({
      functionResponse: {
       name: call.name,
       response: typeof res === 'object' ? res : { message: res },
      },
     });
    }

    const second = await chat.sendMessage(responses);
        const finalCandidate = second.response.candidates?.[0];
        const finalText = finalCandidate?.content?.parts?.map(p => p.text).join('\n') || null;

    if (!finalText) {
     const firstFR = responses[0]?.functionResponse?.response;
     return typeof firstFR === 'object' ? JSON.stringify(firstFR, null, 2) : String(firstFR);
    }

    console.log('[ASSISTANT] Resposta final (model):', finalText);
    return finalText;
   }

   return parts.map(p => p.text).join('\n') || 'Não consegui compreender a pergunta.';
  } catch (err) {
   console.error('[ASSISTANT] ERRO no orquestrador:', err);
   return 'Erro ao processar a solicitação da IA.';
  }
 }
}

module.exports = new AssistantService();