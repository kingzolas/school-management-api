const { genAI } = require('../../config/gemini.js');
const mongoose = require('mongoose');

// Importação dos Models
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const Class = require('../models/class.model.js');
const Enrollment = require('../models/enrollment.model.js');
const User = require('../models/user.model.js');
const Horario = require('../models/horario.model.js');
const Evento = require('../models/evento.model.js');
const School = require('../models/school.model.js');
const Negotiation = require('../models/negotiation.model.js');
const Invoice = require('../models/invoice.model.js');

// ==========================================================
// CONFIGURAÇÃO
// ==========================================================
const MODEL_PRIORITY = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-pro-preview', ]; // Ajuste conforme disponibilidade
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const dayMap = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const dayMapToNumber = { 'domingo': 0, 'segunda': 1, 'terça': 2, 'terca': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5, 'sábado': 6, 'sabado': 6 };

// Helpers
function calculateAge(birthDate) {
    if (!birthDate) return null;
    const birth = new Date(birthDate);
    const hoje = new Date();
    let idade = hoje.getFullYear() - birth.getFullYear();
    const m = hoje.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < birth.getDate())) idade--;
    return idade;
}

// ==========================================================
// 1. CÉREBRO: INSTRUÇÕES DO SISTEMA (ATUALIZADO)
// ==========================================================
const systemInstructionText = `
Você é o **Agente Analítico do AcademyHub**.
Sua inteligência deve superar a busca básica. Você deve **analisar** os dados antes de responder.

🧠 ESTRATÉGIA DE BUSCA INTELIGENTE (SIGA RIGOROSAMENTE):
1. Se o usuário perguntar por um nome parcial (ex: "Quem é Emanuelle?", "Notas do João"), **NÃO** chame 'getStudentInfo' imediatamente. Isso falhará se o nome estiver incompleto.
2. PRIMEIRO: Chame a ferramenta 'listPeople' ou 'findPerson' para ver quem existe na escola.
3. ANALISE A LISTA: A IA (você) deve olhar os resultados. Se o usuário disse "Emanuelle" e na lista tem "Emanuelle Oliveira Araujo", **VOCÊ** faz a associação lógica de que é a mesma pessoa.
4. SÓ ENTÃO: Use o **Nome Completo** correto encontrado para chamar 'getStudentInfo' ou outras funções específicas.

🛡️ RECUPERAÇÃO DE ERRO:
Se uma busca retornar vazio, tente buscar apenas pelo primeiro nome ou verifique a lista geral de alunos.

🏥 SAÚDE: Se a pergunta for sobre saúde, busque os detalhes completos do aluno primeiro.

📅 Hoje: ${new Date().toLocaleDateString('pt-BR')}.
`;

// ==========================================================
// 2. DEFINIÇÃO DAS FERRAMENTAS
// ==========================================================
const toolsDefinitions = [
 {
  functionDeclarations: [
    // --- NOVA FERRAMENTA PODEROSA ---
    {
        name: 'listPeople',
        description: "Retorna uma lista resumida de pessoas (Alunos/Staff). Use isso PRIMEIRO para descobrir o nome correto de alguém quando o usuário der apenas um primeiro nome ou apelido.",
        parameters: {
            type: 'object',
            properties: {
                role: { type: 'string', enum: ['student', 'staff'], description: "Tipo de pessoa para listar." },
                limit: { type: 'number', description: "Limite de resultados (padrão 50)" }
            }
        }
    },
    // --------------------------------
    {
        name: 'findPerson',
        description: "Busca específica por termo (Nome parcial, CPF, Email). Use para refinar buscas.",
        parameters: {
            type: 'object',
            properties: {
                searchTerm: { type: 'string' }
            },
            required: ['searchTerm']
        }
    },
    {
        name: 'getStudentInfo',
        description: "RAIO-X DETALHADO. Use APENAS quando já souber o NOME COMPLETO exato do aluno através de 'listPeople' ou 'findPerson'. Retorna saúde, responsáveis, endereço, etc.",
        parameters: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name']
        }
    },
    {
      name: 'getStudentFinancialInfo',
      description: "Financeiro. Requer nome completo.",
      parameters: {
        type: 'object',
        properties: {
          studentName: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'paid', 'overdue', 'canceled', 'all'] },
          intent: { type: 'string', enum: ['consult', 'payment_code'] }
        },
        required: ['studentName']
      }
    },
    {
        name: 'getStudentAcademicPerformance',
        description: "Boletim/Notas. Requer nome completo.",
        parameters: {
             type: 'object',
             properties: { name: { type: 'string' }, schoolYear: { type: 'number' } },
             required: ['name']
        }
    },
    {
     name: 'analyzeSchoolData',
     description: "Estatísticas: Qtd alunos, gêneros, bairros, aniversariantes.",
     parameters: {
      type: 'object',
      properties: {
       analysisType: { type: 'string', enum: ['aniversario', 'raça', 'gênero', 'contagem'] }, 
       neighborhood: { type: 'string' },
       gender: { type: 'string' },
       startMonth: { type: 'number' },
       endMonth: { type: 'number' },
      },
      required: ['analysisType']
     }
    }
  ]
 }
];

// ==========================================================
// 3. IMPLEMENTAÇÃO SCOPED
// ==========================================================
const createScopedTools = (schoolId) => {
    
    const SCHOOL_FILTER = { school_id: schoolId }; 

    return {
        // --- NOVA IMPLEMENTAÇÃO: LISTAGEM INTELIGENTE ---
        listPeople: async ({ role = 'student', limit = 100 }) => {
            console.log(`[TOOL] listPeople (${role}) @ ${schoolId}`);
            
            // Retorna apenas dados essenciais para a IA "pensar" sem estourar tokens
            if (role === 'student') {
                const students = await Student.find({ ...SCHOOL_FILTER, isActive: true })
                    .select('fullName gender classId') // Trazemos classId para contexto
                    .limit(limit)
                    .lean();
                
                // Mapeia para um formato textual leve que a IA entende bem
                return { 
                    contexto: "Lista de Alunos Ativos (Use para corrigir nomes parciais)",
                    lista: students.map(s => `Nome: ${s.fullName} | ID: ${s._id}`) 
                };
            } else {
                const staff = await User.find({ ...SCHOOL_FILTER }).select('fullName roles').limit(limit).lean();
                return { lista: staff.map(u => `${u.fullName} (${u.roles.join(',')})`) };
            }
        },

        findPerson: async ({ searchTerm }) => {
            console.log(`[TOOL] findPerson: '${searchTerm}'`);
            const cleanTerm = searchTerm.trim();
            const regex = new RegExp(cleanTerm, 'i');
            
            const students = await Student.find({ 
                ...SCHOOL_FILTER, 
                $or: [{ fullName: regex }, { email: regex }] 
            }).limit(5).select('fullName email').lean();

            if (!students.length) return { message: "Nenhum aluno encontrado com esse termo exato." };

            return { 
                candidatos_encontrados: students.map(s => s.fullName),
                instrucao: "IA: Analise se algum destes é quem o usuário procura."
            };
        },

        getStudentInfo: async ({ name }) => {
            console.log(`[TOOL] getStudentInfo: '${name}'`);
            
            // Busca exata ou muito próxima
            const student = await Student.findOne({ 
                fullName: { $regex: new RegExp(`^${name.trim()}$`, 'i') }, // Tenta match exato primeiro (case insensitive)
                ...SCHOOL_FILTER 
            })
            .populate({ path: 'tutors.tutorId', model: 'Tutor', select: '-password' })
            .lean();

            // Se não achar exato, tenta contém (fallback)
            let finalStudent = student;
            if (!finalStudent) {
                 finalStudent = await Student.findOne({ 
                    fullName: { $regex: new RegExp(name.trim(), 'i') },
                    ...SCHOOL_FILTER 
                })
                .populate({ path: 'tutors.tutorId', model: 'Tutor', select: '-password' })
                .lean();
            }

            if (!finalStudent) return { error: `Não consegui carregar os detalhes de '${name}'. Tente verificar o nome na lista geral primeiro.` };

            const enrollment = await Enrollment.findOne({ student: finalStudent._id, status: 'Ativa' })
                .populate('class', 'name grade shift')
                .lean();

            return {
                dados_pessoais: {
                    nome_completo: finalStudent.fullName,
                    nascimento: finalStudent.birthDate ? new Date(finalStudent.birthDate).toLocaleDateString() : 'N/A',
                    idade: calculateAge(finalStudent.birthDate),
                    cpf: finalStudent.cpf || 'Não inf.',
                    endereco: finalStudent.address
                },
                saude: {
                    alerta: (finalStudent.healthInfo?.hasAllergy || finalStudent.healthInfo?.hasHealthProblem) ? "⚠️ ATENÇÃO" : "Normal",
                    alergias: finalStudent.healthInfo?.allergyDetails || 'Nenhuma',
                    medicamentos: finalStudent.healthInfo?.medicationDetails || 'Nenhum',
                    observacoes: finalStudent.healthInfo?.foodObservations || ''
                },
                matricula: enrollment ? {
                    turma: enrollment.class?.name,
                    serie: enrollment.class?.grade,
                    turno: enrollment.class?.shift
                } : "Aluno sem matrícula ativa no momento.",
                responsaveis: (finalStudent.tutors || []).map(t => ({
                    nome: t.tutorId?.fullName,
                    telefone: t.tutorId?.phoneNumber,
                    vinculo: t.relationship
                }))
            };
        },

        getStudentFinancialInfo: async ({ studentName, status, intent }) => {
            // Busca mais permissiva para o financeiro
            const student = await Student.findOne({ fullName: new RegExp(studentName.trim(), 'i'), ...SCHOOL_FILTER }).select('_id fullName');
            if (!student) return { error: "Aluno não encontrado para consulta financeira." };

            const query = { student: student._id };
            if (status === 'overdue') {
                query.status = 'pending';
                query.dueDate = { $lt: new Date() };
            } else if (status && status !== 'all') {
                query.status = status;
            }

            const invoices = await Invoice.find(query).sort({ dueDate: 1 }).lean();

            if (intent === 'payment_code') {
                const pending = invoices.find(i => i.status === 'pending');
                if (!pending) return { message: "Não há faturas pendentes para gerar código." };
                return { 
                    message: `Código PIX gerado para a fatura de ${new Date(pending.dueDate).toLocaleDateString()}.`,
                    hidden_payload: `:::INVOICE_JSON:::${JSON.stringify({ ...pending, mp_pix_qr_base64: '' })}:::INVOICE_JSON:::` 
                };
            }

            return {
                aluno: student.fullName,
                total_faturas: invoices.length,
                lista: invoices.map(i => ({
                    vencimento: new Date(i.dueDate).toLocaleDateString(),
                    valor: i.value,
                    status: i.status === 'pending' ? (new Date(i.dueDate) < new Date() ? 'ATRASADO' : 'ABERTO') : i.status
                }))
            };
        },

        getStudentAcademicPerformance: async ({ name, schoolYear }) => {
            const student = await Student.findOne({ fullName: new RegExp(name.trim(), 'i'), ...SCHOOL_FILTER }).select('fullName academicHistory');
            if (!student) return { error: "Aluno não encontrado." };
            
            const year = schoolYear || new Date().getFullYear();
            const record = student.academicHistory?.find(r => r.schoolYear === year);
            
            if (!record) return { message: `O aluno ${student.fullName} não possui boletim registrado para o ano ${year}.` };

            return {
                aluno: student.fullName,
                situacao_final: record.finalResult,
                notas_detalhadas: record.grades.map(g => `${g.subjectName}: ${g.gradeValue}`)
            };
        },

        analyzeSchoolData: async ({ analysisType, neighborhood, gender, startMonth, endMonth }) => {
            console.log(`[TOOL] Analyze: ${analysisType}`);
            const match = { ...SCHOOL_FILTER };
            if (neighborhood) match['address.neighborhood'] = new RegExp(neighborhood, 'i');
            if (gender) match.gender = new RegExp(gender, 'i');

            if (analysisType === 'aniversario') {
                const targetStart = startMonth || 1;
                const targetEnd = endMonth || 12;
                const aniversariantes = await Student.aggregate([
                    { $match: match },
                    { $project: { fullName: 1, birthDate: 1, month: { $month: "$birthDate" } } },
                    { $match: { month: { $gte: targetStart, $lte: targetEnd } } }
                ]);
                return { 
                    resumo: `Aniversariantes (${targetStart}-${targetEnd})`,
                    lista: aniversariantes.map(s => `${s.fullName} - ${new Date(s.birthDate).getDate()}/${new Date(s.birthDate).getMonth()+1}`) 
                };
            }

            if (analysisType === 'contagem') {
                const count = await Student.countDocuments(match);
                return { 
                    analise: "Contagem de Alunos",
                    filtros: { bairro: neighborhood || 'Todos', genero: gender || 'Todos' },
                    total: count 
                };
            }
            
            return { message: "Tipo de análise não suportado." };
        }
    };
};

// ==========================================================
// 4. SERVIÇO PRINCIPAL (ORQUESTRADOR)
// ==========================================================
class AssistantService {
  async generateResponse(prompt, history, userId, schoolId) {
    if (!schoolId) throw new Error("SchoolId missing.");

    const scopedToolImplementations = createScopedTools(schoolId);

    for (const modelName of MODEL_PRIORITY) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          tools: toolsDefinitions,
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        });

        const chat = model.startChat({
          history: [
            { role: 'user', parts: [{ text: systemInstructionText }] },
            { role: 'model', parts: [{ text: `Sistema iniciado. Conectado à escola ID ${schoolId}.` }] },
            ...(history || []),
          ],
        });

        let result = await chat.sendMessage(prompt);
        let candidate = result.response.candidates?.[0];
        let currentTurn = 0;
        const MAX_TURNS = 6; 

        // Loop de Raciocínio (Chain of Thought via Tools)
        while (candidate?.content?.parts?.some(p => p.functionCall) && currentTurn < MAX_TURNS) {
            currentTurn++;
            const parts = candidate.content.parts;
            const functionCalls = parts.filter(p => !!p.functionCall).map(p => p.functionCall);
            const responses = [];

            console.log(`[AGENTE] Raciocínio ${currentTurn}: Executando ${functionCalls.map(f => f.name).join(', ')}`);

            for (const call of functionCalls) {
                const impl = scopedToolImplementations[call.name];
                let functionResult;

                if (impl) {
                    try {
                        functionResult = await impl(call.args);
                    } catch (err) {
                        console.error(`Erro tool ${call.name}:`, err);
                        functionResult = { error: `Erro na execução: ${err.message}` };
                    }
                } else {
                    functionResult = { error: `Ferramenta ${call.name} não existe.` };
                }

                // Payload oculto
                if (functionResult.hidden_payload) {
                    functionResult = { 
                        ...functionResult,
                        aviso_interno: "Payload gráfico gerado para o usuário." 
                    };
                }

                responses.push({
                    functionResponse: {
                        name: call.name,
                        response: functionResult
                    }
                });
            }

            result = await chat.sendMessage(responses);
            candidate = result.response.candidates?.[0];
        }

        const finalText = candidate?.content?.parts?.map(p => p.text).join('\n');
        return finalText || "Concluí a análise, mas não tenho texto para exibir.";

      } catch (err) {
        console.warn(`[AGENTE] Falha no modelo ${modelName}:`, err.message);
        await sleep(1000);
      }
    }
    
    return "O assistente está sobrecarregado no momento. Tente novamente.";
  }
}

module.exports = new AssistantService();