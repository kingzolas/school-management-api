const { genAI } = require('../../config/gemini.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const Class = require('../models/class.model.js');
const Enrollment = require('../models/enrollment.model.js');
const User = require('../models/user.model.js');
const Horario = require('../models/horario.model.js');
const Subject = require('../models/subject.model.js');
const Periodo = require('../models/periodo.model.js');
const CargaHoraria = require('../models/cargaHoraria.model.js'); 
const StaffProfile = require('../models/staffProfile.model.js'); 
const Invoice = require('../models/invoice.model.js');
// --- NOVOS IMPORTS PARA COBERTURA TOTAL (CRÍTICO) ---
const Evento = require('../models/evento.model.js');
const School = require('../models/school.model.js');
const Negotiation = require('../models/negotiation.model.js');
const mongoose = require('mongoose');

// Acesso aos modelos compilados (Pattern Singleton Mongoose)
const SchoolYear = mongoose.models.SchoolYear || mongoose.model('SchoolYear'); 

// ==========================================================
// CONFIGURAÇÃO DE RESILIÊNCIA (MODELOS E RETRY)
// ==========================================================
// Ordem de prioridade: Padrão -> Mais Leve -> Mais Potente
const MODEL_PRIORITY = [
    'gemini-2.5-flash',      // 1º: Padrão (Equilibrado)
    'gemini-2.5-flash-lite', // 2º: Fallback Rápido (Se o Flash estiver cheio)
    'gemini-2.5-pro'         // 3º: Fallback Robusto (Último recurso)
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================================
// 1. CÉREBRO: "MANUAL DE INSTRUÇÕES" & MAPA DE DADOS
// ==========================================================
const systemInstructionText = `
Você é um **Agente Analista de Dados Sênior** do sistema AcademyHub.
Sua inteligência vai além de responder perguntas simples: você investiga, cruza dados e raciocina para resolver problemas complexos.

🗺️ SEU MAPA MENTAL DO BANCO DE DADOS:
Você tem acesso a TODAS as áreas do sistema. Use este guia para navegar:

1. **Institucional & Calendário:**
   - **School**: Dados da escola (CNPJ, Endereço, Contato).
   - **Evento**: Calendário escolar (Feriados, Reuniões, Provas, Eventos).
   - **SchoolYear**: Anos letivos configurados.

2. **Pessoas (Identity):**
   - **Student (Alunos)**: Entidade central. Possui lista de 'tutors' (pais) e 'Class' (via Enrollment).
   - **Tutor (Responsáveis)**: Onde estão os DADOS CIVIS (CPF, RG, Endereço, Profissão).
   - **User (Staff/Professores)**: Usuários do sistema. Contratos estão em 'StaffProfile'.

3. **Acadêmico (School Life):**
   - **Enrollment**: Conecta Student -> Class.
   - **Class**: A Turma (Ex: '3º Ano A'). Define o Turno e a Série.
   - **Horario**: A Grade de Aulas. Conecta Class + Subject + Teacher + Dia da Semana.
   - **Subject**: A Disciplina (Matemática, História).
   - **CargaHoraria**: Planejamento de horas (Planejado vs Realizado).

4. **Financeiro & Cobrança:**
   - **Invoice**: Faturas geradas. Linkam Student (beneficiário) e Tutor (pagador).
   - **Negotiation**: Histórico de acordos e negociações de dívidas.

🧠 PROTOCOLO DE RACIOCÍNIO (CHAIN OF THOUGHT):
Você tem permissão para executar múltiplas ferramentas em sequência (Loop de Agente) até ter certeza da resposta.

- **Caso 1: Feriados/Eventos**
  - *User:* "Tem aula amanhã?" ou "Quais os feriados da semana?"
  - *Pensamento:* "Preciso consultar o calendário."
  - *Ação:* Use 'getSchoolEvents' definindo as datas.

- **Caso 2: Grade de Horários (Indireta)**
  - *User:* "Que aula a Milena tem sexta-feira?"
  - *Pensamento:* "Eu não sei a turma da Milena. A ferramenta 'getSchedule' pede ID ou Nome da Turma. Preciso descobrir a turma primeiro."
  - *Ação 1:* Chame 'getStudentInfo({ name: 'Milena' })'.
  - *Análise:* O retorno mostra que ela está na turma '9º Ano B'.
  - *Pensamento:* "Agora tenho a turma. Vou buscar a grade."
  - *Ação 2:* Chame 'getSchedule({ className: '9º Ano B', dayOfWeek: 'Sexta-feira' })'.
  - *Resultado:* Responda ao usuário.

- **Caso 3: Financeiro**
  - Se o retorno de 'getStudentFinancialInfo' indicar 'actionType: RENDER_INVOICE_CARD', sua resposta final deve ser curta e conter OBRIGATORIAMENTE a tag oculta :::INVOICE_JSON::: fornecida pela ferramenta.

📅 Contexto Temporal: Hoje é ${new Date().toLocaleDateString('pt-BR')}, ${new Date().toLocaleDateString('pt-BR', { weekday: 'long' })}.
`;

// ==========================================================
// 2. CORPO: FERRAMENTAS (TOOLS)
// ==========================================================
const tools = [
 {
  functionDeclarations: [
    // --- ÁREA: INSTITUCIONAL & EVENTOS ---
    {
        name: 'getSchoolEvents',
        description: "Busca no CALENDÁRIO ESCOLAR: Feriados, Reuniões, Provas ou Eventos. Use datas no formato ISO (YYYY-MM-DD) ou deixe em branco para ver eventos futuros próximos.",
        parameters: {
            type: 'object',
            properties: {
                startDate: { type: 'string', description: "Data inicial (YYYY-MM-DD)." },
                endDate: { type: 'string', description: "Data final (YYYY-MM-DD)." },
                type: { type: 'string', description: "Tipo opcional (Feriado, Reunião, Pedagógico)." }
            }
        }
    },
    {
        name: 'getSchoolDetails',
        description: "Busca dados da própria instituição: Endereço, Telefone, CNPJ, Razão Social.",
        parameters: { type: 'object', properties: {} } // Sem parâmetros, traz a escola ativa
    },

    // --- ÁREA: BUSCA GERAL ---
    {
        name: 'findPerson',
        description: "Busca UNIVERSAL (Google do sistema). Encontra Alunos, Responsáveis ou Staff por CPF, RG, E-mail, Telefone ou Nome Parcial. Use para identificar donos de documentos ou contatos perdidos.",
        parameters: {
            type: 'object',
            properties: {
                searchTerm: { type: 'string', description: "Termo de busca (CPF, email, nome, telefone)." },
                role: { type: 'string', enum: ['student', 'tutor', 'staff', 'any'], description: "Filtro de tipo de pessoa (opcional)." }
            },
            required: ['searchTerm']
        }
    },

    // --- ÁREA: FINANCEIRO & NEGOCIAÇÃO ---
    {
      name: 'getStudentFinancialInfo',
      description: "Busca situação financeira, faturas, débitos ou códigos PIX.",
      parameters: {
        type: 'object',
        properties: {
          studentName: { type: 'string' },
          month: { type: 'number' },
          year: { type: 'number' },
          status: { type: 'string', enum: ['pending', 'paid', 'overdue', 'canceled', 'all'] },
          intent: { type: 'string', enum: ['consult', 'payment_code'] }
        },
        required: ['studentName']
      },
    },
    {
        name: 'getNegotiations',
        description: "Busca histórico de negociações/acordos financeiros de um aluno ou responsável.",
        parameters: {
            type: 'object',
            properties: {
                studentName: { type: 'string' },
                status: { type: 'string', enum: ['active', 'completed', 'broken', 'all'] }
            },
            required: ['studentName']
        }
    },

    // --- ÁREA: ALUNOS & ACADÊMICO ---
   {
    name: 'getStudentInfo',
    description: "Raio-X do Aluno: Retorna TODOS os dados cadastrais, matrícula e, PRINCIPALMENTE, os dados completos dos responsáveis (CPF, RG, Profissão, Trabalho). Use para descobrir turmas e parentesco.",
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
   },
   {
    name: 'getStudentAcademicPerformance',
    description: "Boletim escolar: notas, faltas e desempenho.",
    parameters: {
      type: 'object',
      properties: {
       name: { type: 'string' },
       schoolYear: { type: 'number' },
      },
      required: ['name'],
     },
    },
    {
     name: 'findStudents',
     description: "Listagem/Filtro de alunos (útil para contar quantos alunos existem em uma categoria).",
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
     description: "Análises demográficas (Estatísticas de Gênero, Raça, Bairro, Deficiências).",
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
       startMonth: { type: 'number' },
       endMonth: { type: 'number' },
      },
     },
    },
    {
        name: 'analyzeStudentData',
        description: "Coleta dados brutos de idade ou notas para cálculos estatísticos (média, percentual).",
        parameters: {
            type: 'object',
            properties: {
                targetAnalysis: { type: 'string', enum: ['idade', 'media_notas'] },
                className: { type: 'string' },
            },
            required: ['targetAnalysis'],
        },
    },
    {
        name: 'getCurriculumInfo',
        description: "Matriz Curricular: Carga horária planejada vs realizada.",
        parameters: {
            type: 'object',
            properties: {
                className: { type: 'string' },
                subjectName: { type: 'string' },
                periodoName: { type: 'string' },
            },
        },
    },
    {
        name: 'getSchedule',
        description: "Grade de Aulas (Horário Escolar). Filtra por Turma, Professor ou Dia. Se precisar da grade de um aluno, descubra a turma dele antes.",
        parameters: {
            type: 'object',
            properties: {
                className: { type: 'string', description: "Nome da turma (Ex: '9º Ano A')" },
                subjectName: { type: 'string' },
                teacherName: { type: 'string' },
                dayOfWeek: { type: 'string', description: "Ex: 'Segunda-feira'" },
            },
        },
    },
   {
    name: 'getTeacherInfo',
    description: "Dados de RH: Contratos, Salários e Habilitações de Professores/Staff.",
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

// Funções Utilitárias
function calculateAge(birthDate) {
    if (!birthDate) return null;
    const birth = new Date(birthDate);
    const hoje = new Date();
    let idade = hoje.getFullYear() - birth.getFullYear();
    const m = hoje.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < birth.getDate())) idade--;
    return idade;
}

function parseGradeToNumber(gradeString) {
    if (!gradeString || gradeString.toLowerCase() === 'apto') return null;
    const numericPart = gradeString.replace(',', '.').replace(/[^\d.]/g, '');
    const number = parseFloat(numericPart);
    return isNaN(number) ? null : number;
}

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
// 3. MEMBROS: IMPLEMENTAÇÃO (LÓGICA)
// ==========================================================
const toolImplementations = {

  // --- INSTITUCIONAL E CALENDÁRIO ---
  getSchoolEvents: async ({ startDate, endDate, type }) => {
    console.log(`[TOOL] getSchoolEvents: ${startDate} a ${endDate} (Tipo: ${type || 'Todos'})`);
    try {
        const query = {};
        
        // Se não passar data, pega os próximos 30 dias
        const start = startDate ? new Date(startDate) : new Date();
        const end = endDate ? new Date(endDate) : new Date(new Date().setDate(new Date().getDate() + 30));
        
        query.date = { $gte: start, $lte: end };
        
        if (type) {
            query.type = new RegExp(type, 'i');
        }

        // Busca eventos e ordena por data
        const events = await Evento.find(query).sort({ date: 1 }).lean();

        if (!events.length) return { message: `Nenhum evento encontrado entre ${start.toLocaleDateString()} e ${end.toLocaleDateString()}.` };

        return {
            message: `Encontrei ${events.length} eventos.`,
            eventos: events.map(e => ({
                titulo: e.title,
                data: new Date(e.date).toLocaleDateString('pt-BR'),
                tipo: e.type,
                descricao: e.description || 'N/A'
            }))
        };
    } catch (err) {
        return { error: `Erro ao buscar eventos: ${err.message}` };
    }
  },

  getSchoolDetails: async () => {
    console.log(`[TOOL] getSchoolDetails`);
    try {
        // Pega a primeira escola cadastrada (normalmente só há uma)
        const school = await School.findOne().lean();
        if (!school) return { message: "Nenhuma escola cadastrada no sistema." };
        
        return {
            nome: school.name,
            cnpj: school.cnpj,
            email: school.email,
            telefone: school.phone,
            endereco: school.address,
            diretor: school.principalName
        };
    } catch (err) {
        return { error: err.message };
    }
  },

  // --- FINANCEIRO AVANÇADO ---
  getNegotiations: async ({ studentName, status }) => {
    console.log(`[TOOL] getNegotiations: ${studentName}`);
    try {
        const student = await Student.findOne({ fullName: new RegExp(studentName, 'i') }).select('_id').lean();
        if (!student) return { error: `Aluno '${studentName}' não encontrado.` };

        const query = { student: student._id };
        if (status && status !== 'all') query.status = status;

        const negotiations = await Negotiation.find(query).sort({ createdAt: -1 }).lean();

        if (!negotiations.length) return { message: `Nenhuma negociação encontrada para este aluno.` };

        return {
            total: negotiations.length,
            negociacoes: negotiations.map(n => ({
                data: new Date(n.createdAt).toLocaleDateString(),
                status: n.status,
                valorTotal: (n.totalAmount / 100).toFixed(2),
                parcelas: n.installmentsCount
            }))
        };
    } catch (err) {
        return { error: err.message };
    }
  },
  
  // --- BUSCA UNIVERSAL ---
  findPerson: async ({ searchTerm, role = 'any' }) => {
    console.log(`[TOOL] findPerson: Buscando '${searchTerm}' em role: ${role}`);
    const cleanTerm = searchTerm.replace(/[^a-zA-Z0-9@\.]/g, ''); 
    const isDigits = /^\d+$/.test(cleanTerm.replace(/\D/g, ''));
    const regex = new RegExp(searchTerm, 'i');

    // Estratégia: Busca textual ou numérica
    const textFilters = { $or: [{ fullName: regex }, { email: regex }, { phoneNumber: regex }] };
    const docFilters = isDigits ? { $or: [{ cpf: { $regex: cleanTerm } }, { rg: { $regex: cleanTerm } }] } : null;
    
    const finalFilter = docFilters ? { $or: [...textFilters.$or, ...docFilters.$or] } : textFilters;

    const results = { students: [], tutors: [], staff: [] };

    try {
        // Executa as buscas em paralelo para performance
        const promises = [];
        
        if (role === 'any' || role === 'student') {
            promises.push(Student.find(finalFilter).select('fullName cpf rg email phoneNumber').lean().then(r => results.students = r));
        }
        if (role === 'any' || role === 'tutor') {
            promises.push(Tutor.find(finalFilter).select('fullName cpf rg email phoneNumber profession workplace').lean().then(r => results.tutors = r));
        }
        if (role === 'any' || role === 'staff') {
            promises.push(User.find({ ...finalFilter, roles: { $in: ['Admin', 'Manager', 'Professor', 'Staff'] } }).select('fullName email phoneNumber roles').lean().then(r => results.staff = r));
        }
        
        await Promise.all(promises);

        const matches = [];
        results.students.forEach(s => matches.push(`[ALUNO] Nome: ${s.fullName}, CPF: ${s.cpf || 'N/A'}, Email: ${s.email}`));
        results.tutors.forEach(t => matches.push(`[RESPONSÁVEL] Nome: ${t.fullName}, CPF: ${t.cpf || 'N/A'}, Profissão: ${t.profession || 'N/A'}, Local Trabalho: ${t.workplace || 'N/A'}`));
        results.staff.forEach(u => matches.push(`[STAFF] Nome: ${u.fullName}, Cargo: ${u.roles.join('/')}, Email: ${u.email}`));

        if (matches.length === 0) return { message: `Nenhuma pessoa encontrada para o termo '${searchTerm}'. Tente remover pontuação ou buscar parte do nome.` };
        
        return { 
            message: `Encontrei ${matches.length} registro(s).`,
            dados: matches
        };

    } catch (err) {
        return { error: `Erro na busca universal: ${err.message}` };
    }
  },

  getStudentFinancialInfo: async ({ studentName, month, year, status, intent }) => {
    console.log(`[TOOL] getStudentFinancialInfo: ${studentName} (Intent: ${intent})`);

    try {
      const student = await Student.findOne({ fullName: new RegExp(studentName, 'i') }).select('_id fullName').lean();
      if (!student) return { error: `Aluno '${studentName}' não encontrado.` };

      const query = { student: student._id };

      if (month || year) {
        const targetYear = year || new Date().getFullYear();
        let startDate, endDate;
        if (month) {
           startDate = new Date(targetYear, month - 1, 1);
           endDate = new Date(targetYear, month, 0, 23, 59, 59);
        } else {
           startDate = new Date(targetYear, 0, 1);
           endDate = new Date(targetYear, 11, 31, 23, 59, 59);
        }
        query.dueDate = { $gte: startDate, $lte: endDate };
      }

      if (status && status !== 'all') {
        if (status === 'overdue') {
           query.status = 'pending';
           query.dueDate = { $lt: new Date() };
        } else {
           query.status = status;
        }
      }

      const invoices = await Invoice.find(query)
        .populate('tutor', 'fullName cpf email') 
        .populate('student', 'fullName')
        .sort({ dueDate: 1 })
        .lean();

      if (!invoices || invoices.length === 0) {
        return { message: `Nenhuma fatura encontrada para ${student.fullName} com os critérios informados.` };
      }

      // Intenção PAGAMENTO (QR CODE)
      if (intent === 'payment_code') {
           const targetInvoice = invoices.find(inv => inv.status === 'pending');
           if (!targetInvoice) {
             return { message: `O aluno ${student.fullName} não possui faturas pendentes no filtro selecionado.` };
           }

           const lightInvoice = { ...targetInvoice };
           lightInvoice.mp_pix_qr_base64 = ""; // Limpa string grande se existir, mantém só o necessário

           const safeJsonString = JSON.stringify(lightInvoice);

           return {
             message: `Fatura encontrada. Instruindo frontend a renderizar.`,
             hidden_payload: `:::INVOICE_JSON:::${safeJsonString}:::INVOICE_JSON:::`,
           };
      }
      
      // Intenção CONSULTA
      const summary = {
        total: invoices.length,
        totalValue: invoices.reduce((acc, cur) => acc + cur.value, 0),
        statusBreakdown: {
          paid: invoices.filter(i => i.status === 'paid').length,
          pending: invoices.filter(i => i.status === 'pending' && new Date(i.dueDate) >= new Date()).length,
          overdue: invoices.filter(i => i.status === 'pending' && new Date(i.dueDate) < new Date()).length,
          canceled: invoices.filter(i => i.status === 'canceled').length,
        },
        invoices: invoices.map(i => ({
           id: i._id,
           vencimento: new Date(i.dueDate).toLocaleDateString(),
           valor: (i.value / 100).toFixed(2),
           status: i.status,
           pagador: i.tutor?.fullName || 'Não definido'
        }))
      };

      return {
         message: `Resumo financeiro de ${student.fullName}: ${summary.statusBreakdown.overdue} em atraso, ${summary.statusBreakdown.paid} pagas.`,
         data: summary
      };

    } catch (err) {
      console.error('[TOOL] Erro financeiro:', err);
      return { error: err.message };
    }
  },

 findStudents: async (args) => {
  console.log('[TOOL] findStudents:', JSON.stringify(args));
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
   return { error: err.message };
  }
 },

 // --- RAIO-X DO ALUNO (ONISCIENTE) ---
 getStudentInfo: async ({ name }) => {
  console.log(`[TOOL] getStudentInfo: '${name}'`);
  try {
    // 1. Busca o aluno e popula os tutores SEM esconder campos sensíveis (exceto senhas)
    // Isso permite buscar CPF, RG, Profissão, etc.
   const student = await Student.findOne({ fullName: { $regex: new RegExp(name, 'i') } })
    .populate({ 
        path: 'tutors.tutorId', 
        model: 'Tutor', 
        select: '-password -loginHash -__v' // AQUI ESTÁ O SEGREDO DA ONISCIÊNCIA
    })
    .lean();

   if (!student) return { error: `Aluno '${name}' não encontrado.` };

   const enrollment = await Enrollment.findOne({ student: student._id, status: 'Ativa' })
    .populate({ path: 'class', model: 'Class', select: 'name grade level shift schoolYear status' })
    .lean();

   // Estrutura rica e bruta para a IA interpretar
   const richData = {
    dadosPessoais: {
        _id: student._id,
        nomeCompleto: student.fullName,
        dataNascimento: student.birthDate ? new Date(student.birthDate).toLocaleDateString('pt-BR') : 'N/A',
        idade: calculateAge(student.birthDate),
        genero: student.gender,
        rg: student.rg,
        cpf: student.cpf,
        endereco: student.address,
        saude: student.healthInfo
    },
    academico: enrollment ? {
        turma: enrollment.class?.name,
        serie: enrollment.class?.grade,
        turno: enrollment.class?.shift,
        situacao: enrollment.status
    } : "Sem matrícula ativa",
    // Expondo todos os dados dos responsáveis para a IA filtrar
    responsaveis: (student.tutors || []).map(t => {
        if(!t.tutorId) return null;
        return {
            ...t.tutorId, // Espalha CPF, RG, Profissão, etc.
            tipoRelacionamento: t.relationship,
            autorizadoBuscar: t.authorizedToPickUp
        };
    }).filter(Boolean)
   };

   return richData;
  } catch (err) {
   console.error('[TOOL] Erro em getStudentInfo:', err);
   return { error: `Erro ao obter informações: ${err.message}` };
  }
 },

 getStudentAcademicPerformance: async ({ name, schoolYear = new Date().getFullYear() }) => {
  console.log(`[TOOL] getStudentAcademicPerformance: '${name}'`);
  try {
   const student = await Student.findOne({ fullName: { $regex: new RegExp(name, 'i') } })
    .select('fullName academicHistory')
    .lean();

   if (!student) return { error: `Aluno(a) '${name}' não encontrado(a).` };

   const record = student.academicHistory?.find(r => r.schoolYear === schoolYear);

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
   console.error('[TOOL] Erro acadêmico:', err);
   return { error: `Erro ao buscar desempenho: ${err.message}` };
  }
 },

 analyzeSchoolData: async (args) => {
  console.log('[TOOL] analyzeSchoolData:', JSON.stringify(args));
  const { neighborhood, className, status, shift, hasAllergy, hasDisability, gender, analysisType, startMonth, endMonth } = args || {};

    const studentFilter = {};
    const enrollmentFilter = {};

    const genderMap = {
        masculino: 'Masculino', homem: 'Masculino', meninos: 'Masculino',
        feminino: 'Feminino', mulher: 'Feminino', meninas: 'Feminino',
        outro: 'Outro', outros: 'Outro',
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

    // ANÁLISE DE GÊNERO
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

        return { message: `Análise de Gênero concluída.`, total: totalStudents, analise: 'Gênero', counts: counts };
    }
    
    // ANÁLISE DE ANIVERSÁRIO
    if (analysisType === 'aniversario') {
        if (!startMonth || !endMonth) return { error: "Meses obrigatórios." };
        let studentsToAnalyze = await Student.find(studentFilter).select('_id birthDate').lean();
        if (Object.keys(enrollmentFilter).length > 0) {
            const enrollments = await Enrollment.find(enrollmentFilter).select('student').lean();
            const ids = enrollments.map(e => e.student.toString());
            studentsToAnalyze = studentsToAnalyze.filter(s => ids.includes(s._id.toString()));
        }

        const targetMonths = [];
        let current = startMonth;
        while (true) {
            targetMonths.push(current);
            if (current === endMonth) break;
            current = (current % 12) + 1;
        }
        
        let count = 0;
        studentsToAnalyze.forEach(s => {
            if (s.birthDate && targetMonths.includes(new Date(s.birthDate).getUTCMonth() + 1)) count++;
        });

        return { message: `Aniversariantes encontrados.`, total: count, analise: 'Aniversário', periodo: `${monthNames[startMonth-1]} a ${monthNames[endMonth-1]}` };
    }
    
    // ANÁLISE RACIAL
    if (analysisType === 'raça') {
        const raceGroup = await Student.aggregate([{ $match: studentFilter }, { $group: { _id: '$race', total: { $sum: 1 } } }]);
        let total = 0; const counts = {};
        raceGroup.forEach(i => { counts[i._id || 'N/I'] = i.total; total += i.total; });
        return { message: "Análise racial concluída", total, counts };
    }

    // CONTAGEM PADRÃO
    const count = await Student.countDocuments(studentFilter);
    return { message: `Contagem simples concluída.`, total: count };
 },

 analyzeStudentData: async (args) => {
    console.log('[TOOL] analyzeStudentData:', JSON.stringify(args));
    const { targetAnalysis, className } = args;

    try {
        let studentFilter = {};
        if (className) {
            const turma = await Class.findOne({ name: new RegExp(className, 'i') }).select('_id').lean();
            if (!turma) return { error: `Turma '${className}' não encontrada.` };
            const enrolledStudents = await Enrollment.find({ class: turma._id }).select('student').lean();
            studentFilter._id = { $in: enrolledStudents.map(e => e.student) };
        }
        
        if (targetAnalysis === 'idade') {
            const students = await Student.find(studentFilter).select('birthDate').lean();
            const ageCounts = {};
            let total = 0;
            students.forEach(s => {
                const age = calculateAge(s.birthDate);
                if (age !== null) { ageCounts[age] = (ageCounts[age] || 0) + 1; total++; }
            });
            return { analise: 'Idade', totalStudents: total, distribuicao: ageCounts };
        }
        return { error: `Análise '${targetAnalysis}' não suportada.` };
    } catch (err) {
        return { error: err.message };
    }
},

getCurriculumInfo: async ({ className, subjectName, periodoName }) => {
    console.log(`[TOOL] getCurriculumInfo: Turma=${className}, Materia=${subjectName}`);
    
    try {
        const filter = {};
        
        if (className) {
            const classObj = await Class.findOne({ name: new RegExp(className, 'i') }).select('_id name').lean();
            if (!classObj) return { message: `Turma '${className}' não encontrada.` };
            filter.classId = classObj._id;
        }
        if (subjectName) {
            const subjectObj = await Subject.findOne({ name: new RegExp(subjectName, 'i') }).select('_id name').lean();
            if (!subjectObj) return { message: `Disciplina '${subjectName}' não encontrada.` };
            filter.subjectId = subjectObj._id;
        }
        if (periodoName) {
            const periodoObj = await Periodo.findOne({ titulo: new RegExp(periodoName, 'i') }).sort({ dataFim: -1 }).lean();
            if (periodoObj) filter.periodoId = periodoObj._id;
        } 
        
        const loads = await CargaHoraria.find(filter)
            .populate('subjectId', 'name').populate('classId', 'name').populate('periodoId', 'titulo')
            .lean();
            
        // Simplificando retorno para a IA
        return {
            totalRegistros: loads.length,
            dados: loads.map(l => ({
                disciplina: l.subjectId?.name,
                turma: l.classId?.name,
                horasPlanejadas: l.targetHours,
                periodo: l.periodoId?.titulo
            }))
        };
        
    } catch (err) {
        return { error: `Erro curricular: ${err.message}` };
    }
},

getSchedule: async ({ className, subjectName, teacherName, dayOfWeek }) => {
    console.log(`[TOOL] getSchedule: Turma=${className}, Prof=${teacherName}, Dia=${dayOfWeek}`);
    
    try {
        const filter = {};
        
        if (className) {
            const classObj = await Class.findOne({ name: new RegExp(className, 'i') }).select('_id name').lean();
            if (!classObj) return { error: `Turma '${className}' não encontrada.` };
            filter.classId = classObj._id;
        }
        if (subjectName) {
            const subjectObj = await Subject.findOne({ name: new RegExp(subjectName, 'i') }).select('_id').lean();
            if (!subjectObj) return { error: `Disciplina '${subjectName}' não encontrada.` };
            filter.subjectId = subjectObj._id;
        }
        if (teacherName) {
            const teacherObj = await User.findOne({ fullName: new RegExp(teacherName, 'i') }).select('_id').lean();
            if (!teacherObj) return { error: `Professor '${teacherName}' não encontrado.` };
            filter.teacherId = teacherObj._id;
        }
        if (dayOfWeek) {
            const normalizedDay = dayOfWeek.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace('-feira', '').trim();
            const dayNumber = dayMapToNumber[normalizedDay];
            if (dayNumber !== undefined) filter.dayOfWeek = dayNumber;
        }

        const schedules = await Horario.find(filter)
            .populate('classId', 'name shift')
            .populate('subjectId', 'name')
            .populate('teacherId', 'fullName')
            .sort({ dayOfWeek: 1, startTime: 1 })
            .lean();
            
        if (!schedules.length) return { message: `Nenhuma aula encontrada com esses filtros.` };

        const formatted = schedules.map(s => ({
            dia: dayMap[s.dayOfWeek],
            hora: `${s.startTime} - ${s.endTime}`,
            turma: s.classId?.name,
            materia: s.subjectId?.name,
            professor: s.teacherId?.fullName,
            sala: s.room
        }));

        return {
            message: `Grade encontrada com ${formatted.length} aulas.`,
            aulas: formatted
        };

    } catch (err) {
        return { error: `Erro na grade: ${err.message}` };
    }
},

 getTeacherInfo: async ({ name }) => {
 console.log(`[TOOL] getTeacherInfo: '${name}'`);
 try {
   const user = await User.findOne({ fullName: new RegExp(name, 'i') })
      .populate({
         path: 'staffProfiles',
         populate: { path: 'enabledSubjects', select: 'name' }
      }).lean();

   if (!user) return { error: `Funcionário '${name}' não encontrado.` };

   return {
        nome: user.fullName,
        email: user.email,
        telefone: user.phoneNumber,
        contratos: (user.staffProfiles || []).map(p => ({
            cargo: p.mainRole,
            salario: p.salaryAmount,
            admissao: p.admissionDate
        }))
      };
  } catch (err) {
   return { error: err.message };
  }
 },
};

// ==========================================================
// 4. ORQUESTRADOR: AGENTE RE-ACT (THINK -> ACT -> OBSERVE)
// ==========================================================
class AssistantService {
  async generateResponse(prompt, history, userId) {
    let lastError = null;
    const MAX_TURNS = 5; // Limite de passos para evitar loops infinitos

    // Tenta com modelos diferentes em caso de falha (Flash -> Lite -> Pro)
    for (const modelName of MODEL_PRIORITY) {
      try {
        console.log(`[AGENT] Iniciando pensamento com: ${modelName}`);

        const model = genAI.getGenerativeModel({
          model: modelName,
          tools,
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        });

        const chat = model.startChat({
          history: [
            { role: 'user', parts: [{ text: systemInstructionText }] },
            { role: 'model', parts: [{ text: 'Entendido. Sou um Agente Autônomo. Vou investigar os dados passo a passo até encontrar a resposta exata.' }] },
            ...(history || []),
          ],
        });

        // 1. Envia a pergunta inicial
        let result = await chat.sendMessage(prompt);
        let candidate = result.response.candidates?.[0];
        
        // -----------------------------------------------------
        // O LOOP DE RACIOCÍNIO (The Re-Act Loop)
        // -----------------------------------------------------
        let currentTurn = 0;

        // Enquanto a IA quiser chamar ferramentas...
        while (
            candidate?.content?.parts?.some(p => p.functionCall) && 
            currentTurn < MAX_TURNS
        ) {
            currentTurn++;
            const parts = candidate.content.parts;
            const functionCalls = parts.filter(p => !!p.functionCall).map(p => p.functionCall);
            const responses = [];

            console.log(`[AGENT] Passo ${currentTurn}: Executando ${functionCalls.length} ferramenta(s)...`);

            // Executa cada ferramenta solicitada pela IA
            for (const call of functionCalls) {
                const impl = toolImplementations[call.name];
                let functionResult;

                if (impl) {
                    try {
                        // Executa a função Javascript real
                        functionResult = await impl(call.args);
                    } catch (execErr) {
                        functionResult = { error: `Erro de execução: ${execErr.message}` };
                    }
                } else {
                    functionResult = { error: `Ferramenta '${call.name}' não existe.` };
                }

                // Log leve para debug
                console.log(`   -> ${call.name} retornou dados.`);

                // Tratamento especial para payload oculto (ex: Invoice JSON)
                if (functionResult.hidden_payload) {
                    functionResult = { 
                        message: functionResult.message + "\n" + functionResult.hidden_payload 
                    };
                }

                // Prepara resposta para a IA
                responses.push({
                    functionResponse: {
                        name: call.name,
                        response: typeof functionResult === 'object' ? functionResult : { message: functionResult },
                    },
                });
            }

            // Devolve os resultados para a IA e aguarda o PRÓXIMO pensamento dela
            result = await chat.sendMessage(responses);
            candidate = result.response.candidates?.[0];
        }
        // -----------------------------------------------------

        const finalText = candidate?.content?.parts?.map(p => p.text).join('\n');

        if (!finalText) {
             // Se saiu do loop sem texto, algo estranho aconteceu
             return "Concluí a tarefa, mas não gerei uma resposta de texto. Verifique os logs.";
        }

        console.log(`[AGENT] Raciocínio concluído em ${currentTurn} passos.`);
        return finalText;

      } catch (err) {
        const isOverloaded = err.message.includes('503') || err.message.includes('overloaded') || err.message.includes('500');
        if (isOverloaded) {
          console.warn(`⚠️ [FALLBACK] Modelo ${modelName} instável. Tentando próximo...`);
          lastError = err;
          await sleep(1000);
          continue; 
        } else {
          console.error('[AGENT] Erro fatal:', err);
          throw err; 
        }
      }
    }

    return 'Desculpe, nossos servidores de IA estão momentaneamente sobrecarregados.';
  }
}

module.exports = new AssistantService();