const { genAI } = require('../../config/gemini.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const Class = require('../models/class.model.js');
const Enrollment = require('../models/enrollment.model.js');

// ==========================================================
// 1. "MANUAL DE INSTRUÇÕES"
// ==========================================================
const systemInstructionText = `
Você é um assistente do sistema AcademyHub.
Seu objetivo é ajudar com informações sobre alunos, turmas e dados escolares.

REGRAS GERAIS:
1. Use as ferramentas disponíveis (como 'findStudents' e 'getStudentInfo') para responder perguntas.
2. Sempre escolha a ferramenta mais específica para responder corretamente.
3. Se a pergunta for sobre um aluno específico (ex: "Quem são os pais de Lara Sophia?"), use a ferramenta 'getStudentInfo'.
4. Caso não exista ferramenta adequada, responda com seu próprio conhecimento.
5. Seja breve, amigável e direto.
6. A data atual é: ${new Date().toLocaleDateString('pt-BR')}
`;

// ==========================================================
// 2. FERRAMENTAS
// ==========================================================
const tools = [
  {
    functionDeclarations: [
      {
        name: 'getStudentInfo',
        description: "Obtém informações detalhadas de um aluno (tutores, turma, idade, endereço, etc).",
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: "Nome completo ou parcial do aluno." },
          },
          required: ['name'],
        },
      },
      {
        name: 'findStudents',
        description: "Busca ou conta alunos no sistema com base em filtros gerais.",
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            className: { type: 'string' },
            isActive: { type: 'boolean' },
          },
        },
      },
    ],
  },
];

// ==========================================================
// 3. IMPLEMENTAÇÕES
// ==========================================================
const toolImplementations = {
  // 🔹 Busca de alunos
  findStudents: async (args) => {
    console.log(`[ASSISTANT] IA escolheu: findStudents com args:`, JSON.stringify(args));
    const mongoFilter = {};

    if (args.name) mongoFilter.fullName = { $regex: new RegExp(args.name, 'i') };
    if (args.isActive !== undefined) mongoFilter.isActive = args.isActive;

    try {
      const students = await Student.find(mongoFilter).limit(10).select('fullName isActive').lean();
      const totalCount = await Student.countDocuments(mongoFilter);
      return { totalCount, resultsSample: students };
    } catch (err) {
      console.error('[ASSISTANT] Erro em findStudents:', err);
      return { error: `Erro ao buscar alunos: ${err.message}` };
    }
  },

  // 🔹 Busca detalhada com matrícula (Enrollment)
  getStudentInfo: async ({ name }) => {
    console.log(`[ASSISTANT] IA escolheu: getStudentInfo para '${name}'`);
    try {
      // 1️⃣ Localiza o aluno
      const student = await Student.findOne({
        fullName: { $regex: new RegExp(name, 'i') },
      })
        .populate({
          path: 'tutors.tutorId',
          model: 'Tutor',
          select: 'fullName phoneNumber email',
        })
        .lean();

      if (!student) {
        console.log(`[LOG ❌] Aluno '${name}' não encontrado no banco.`);
        return { error: `Aluno '${name}' não encontrado.` };
      }

      console.log(`[LOG ✅] Aluno encontrado: ${student.fullName} (ID: ${student._id})`);

      // 2️⃣ Busca matrícula ativa do aluno
      const enrollment = await Enrollment.findOne({
        student: student._id,
        status: 'Ativa',
      })
        .populate({
          path: 'class',
          model: 'Class',
          select: 'name grade schoolYear level shift status',
        })
        .lean();

      if (enrollment) {
        console.log(`[LOG ✅] Matrícula encontrada:`, {
          turma: enrollment.class?.name,
          anoLetivo: enrollment.academicYear,
          status: enrollment.status,
        });
      } else {
        console.log(`[LOG ❌] Nenhuma matrícula ativa encontrada para este aluno.`);
      }

      // 3️⃣ Calcula idade
      let idade = null;
      if (student.birthDate) {
        const birth = new Date(student.birthDate);
        const hoje = new Date();
        idade = hoje.getFullYear() - birth.getFullYear();
        const m = hoje.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && hoje.getDate() < birth.getDate())) idade--;
      }

      // 4️⃣ Tutores
      const tutores = (student.tutors || [])
        .filter(t => t.tutorId)
        .map(t => ({
          nome: t.tutorId.fullName,
          parentesco: t.relationship,
          telefone: t.tutorId.phoneNumber,
          email: t.tutorId.email,
        }));

      // 5️⃣ Monta resposta final
      const info = {
        nome: student.fullName,
        idade,
        turma: enrollment
          ? {
              nome: enrollment.class?.name || 'Turma não informada',
              serie: enrollment.class?.grade || 'N/A',
              nivel: enrollment.class?.level || 'N/A',
              anoLetivo: enrollment.academicYear,
              turno: enrollment.class?.shift || 'N/A',
              status: enrollment.status,
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
      };

      return info;
    } catch (err) {
      console.error('[ASSISTANT] Erro em getStudentInfo:', err);
      return { error: `Erro ao obter informações de ${name}: ${err.message}` };
    }
  },
};

// ==========================================================
// 4. ORQUESTRADOR
// ==========================================================
class AssistantService {
  async generateResponse(prompt, history, userId) {
    console.log(`[ASSISTANT] Pergunta: ${prompt}`);

    const modelToUse = 'gemini-2.5-flash';
    let chat, result;

    try {
      const model = genAI.getGenerativeModel({
        model: modelToUse,
        tools,
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      });

      chat = model.startChat({
        history: [
          { role: 'user', parts: [{ text: systemInstructionText }] },
          { role: 'model', parts: [{ text: 'Entendido. Estou pronto para ajudar no AcademyHub.' }] },
          ...history,
        ],
      });

      result = await chat.sendMessage(prompt);
    } catch (apiError) {
      console.error('[ASSISTANT] ERRO FATAL na chamada Gemini:', apiError);
      return 'Erro ao conectar com a IA.';
    }

    const candidate = result.response.candidates?.[0];
    if (!candidate?.content?.parts) return 'Não entendi sua pergunta.';

    const parts = candidate.content.parts;
    const functionCalls = parts.filter(p => !!p.functionCall).map(p => p.functionCall);

    if (functionCalls.length > 0) {
      const functionResponses = [];

      for (const call of functionCalls) {
        const { name, args } = call;
        const implementation = toolImplementations[name];
        const toolResult = implementation
          ? await implementation(args)
          : { error: `Função '${name}' não implementada.` };

        functionResponses.push({
          functionResponse: {
            name,
            response: typeof toolResult === 'object' ? toolResult : { message: toolResult },
          },
        });
      }

      const secondResult = await chat.sendMessage(functionResponses);
      const secondCandidate = secondResult.response.candidates?.[0];
      const finalText =
        secondCandidate?.content?.parts?.map(p => p.text).join('\n') ||
        'Não consegui formular uma resposta final.';

      console.log(`[ASSISTANT] Resposta final: ${finalText}`);
      return finalText;
    }

    const simpleResponse = parts.map(p => p.text).join('\n');
    return simpleResponse || 'Não consegui compreender a pergunta.';
  }
}

module.exports = new AssistantService();
