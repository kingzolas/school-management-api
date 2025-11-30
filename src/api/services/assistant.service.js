const { genAI } = require('../../config/gemini');
const mongoose = require('mongoose');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ==============================================================================
// 1. CONFIGURAÇÃO DE MODELOS
// ==============================================================================
const MODEL_PRIORITY = [
    'gemini-2.0-flash',        // Rápido e inteligente
    'gemini-2.0-flash-lite',   
    'gemini-2.5-flash',        
    'gemini-2.5-pro'           
];

// ==============================================================================
// 2. CONTEXTO DOS MODELS
// ==============================================================================
const models = {
    Student: require('../models/student.model'),
    Class: require('../models/class.model'),
    Enrollment: require('../models/enrollment.model'),
    User: require('../models/user.model'),
    Horario: require('../models/horario.model'),
    Invoice: require('../models/invoice.model'),
    School: require('../models/school.model'),
    StaffProfile: require('../models/staffProfile.model'),
    Subject: require('../models/subject.model'),
    Negotiation: require('../models/negotiation.model'),
    CargaHoraria: require('../models/cargaHoraria.model'), // Adicionado para professores
};

// ==============================================================================
// 3. DEFINIÇÃO DA TOOL
// ==============================================================================
const toolsDefinitions = [
    {
        functionDeclarations: [
            {
                name: 'executeMongooseQuery',
                description: 'EXECUTA JavaScript/Mongoose. Use para buscar dados reais. OBRIGATÓRIO.',
                parameters: {
                    type: 'object',
                    properties: {
                        reasoning: { type: 'string', description: 'Explicação da query.' },
                        code: { type: 'string', description: 'Código JS completo. Use "return" no final.' }
                    },
                    required: ['reasoning', 'code']
                }
            }
        ]
    }
];

class AssistantService {

    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    async retrieveRelevantContext() {
        try {
            const knowledgePath = path.resolve(__dirname, '../../config/knowledge_base.json');
            if (!fs.existsSync(knowledgePath)) return "AVISO: knowledge_base.json ausente.";
            const data = JSON.parse(fs.readFileSync(knowledgePath, 'utf-8'));
            return data.rawText;
        } catch (error) {
            return "";
        }
    }

    async executeSafeQuery(code, schoolId) {
        console.log(`⚡ [SANDBOX] Executando Query...`);
        const sandbox = { models, schoolId, mongoose, result: undefined };
        
        const wrappedCode = `
            (async () => {
                try {
                    const userCode = async () => { ${code} };
                    result = await userCode();
                } catch (e) {
                    result = { __error_exec: e.message };
                }
            })();
        `;

        try {
            vm.createContext(sandbox);
            await vm.runInContext(wrappedCode, sandbox, { timeout: 10000 });
            
            if (sandbox.result && sandbox.result.__error_exec) {
                return { status: 'error', message: `Erro JS: ${sandbox.result.__error_exec}.` };
            }
            if (sandbox.result === undefined) {
                return { status: 'error', message: "Retornou 'undefined'. Faltou 'return'?" };
            }
            return { status: 'success', data: sandbox.result };

        } catch (error) {
            console.error("💥 [SANDBOX] Erro:", error);
            return { status: 'error', message: "Erro fatal no Sandbox." };
        }
    }

    async processRequest(question, history, userId, schoolId) {
        
        const contextDocs = await this.retrieveRelevantContext();

        // --- SISTEMA PROMPT V10 (ZERO TOLERANCE FOR HALLUCINATION) ---
        const systemPrompt = `
        VOCÊ É: O DBA Sênior do AcademyHub.
        
        AMBIENTE: 'models', 'schoolId', 'mongoose'.
        ESQUEMA:
        ${contextDocs}
        
        REGRAS DE VERDADE (ANTI-ALUCINAÇÃO):
        1. SE O DADO NÃO VIER DA QUERY: DIGA "NÃO SEI".
           - É PROIBIDO inventar nomes ("João Silva"), datas ou valores.
           - Se a query retornar [], responda: "Não há registros no sistema para essa busca."
        
        2. FILTRO OBRIGATÓRIO: { school_id: schoolId }.
        
        3. MAPEAMENTO DE ENTIDADES:
           - Alunos: 'fullName' (Student).
           - Turmas: 'name' (Class).
           - Professores: Estão na 'CargaHoraria' ou 'Horario', ligados ao 'User' ou 'StaffProfile'.
           - Horários: Use 'dayOfWeek' (0=Dom, 1=Seg, 2=Ter...).
        
        4. ESTRATÉGIA PARA HORÁRIOS/AULAS:
           - Busque na collection 'Horario'.
           - Use .populate('subjectId') para nome da matéria.
           - Use .populate('teacherId') para nome do professor.
           - Se teacherId for nulo, DIGA "Professor não atribuído". NÃO INVENTE UM NOME.
        
        5. PROTEÇÃO CONTRA NULOS:
           - if (!doc || !doc.teacherId) return "Sem professor";
        
        6. SINTAXE:
           - Use 'await', use 'return'.
        `;

        for (const modelName of MODEL_PRIORITY) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    tools: toolsDefinitions,
                    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
                });

                const chat = model.startChat({
                    history: [
                        { role: 'user', parts: [{ text: systemPrompt }] },
                        { role: 'model', parts: [{ text: "Entendido. Se a query retornar vazio, direi que não há dados. Jamais inventarei nomes como João Silva." }] },
                        ...(history || [])
                    ]
                });

                console.log(`🤖 [${modelName}] Processando: "${question}"`);
                
                const result = await chat.sendMessage(question);
                const candidate = result.response.candidates?.[0];
                const functionCall = candidate?.content?.parts?.find(p => p.functionCall)?.functionCall;

                // --- ANTI-ALUCINAÇÃO DE TOOL ---
                const textResponse = result.response.text();
                if (!functionCall && (textResponse.includes("```javascript") || textResponse.includes("const code"))) {
                    console.warn(`⚠️ [${modelName}] IA tentou escrever código no chat. Forçando erro...`);
                    throw new Error("Alucinação de Tool.");
                }

                if (functionCall && functionCall.name === 'executeMongooseQuery') {
                    const { code, reasoning } = functionCall.args;
                    console.log(`🧠 Raciocínio: ${reasoning}`);
                    console.log(`💻 Código Gerado: ${code}`);

                    const executionResult = await this.executeSafeQuery(code, schoolId);
                    
                    if (executionResult.status === 'error') {
                        // Feedback Loop
                        const retryResponse = await chat.sendMessage([{
                            functionResponse: {
                                name: 'executeMongooseQuery',
                                response: { error: executionResult.message }
                            }
                        }]);
                        return retryResponse.response.text();
                    }

                    // Sucesso
                    const finalResponse = await chat.sendMessage([{
                        functionResponse: {
                            name: 'executeMongooseQuery',
                            response: { data: executionResult.data }
                        }
                    }]);

                    return finalResponse.response.text();
                } 
                
                return result.response.text();

            } catch (error) {
                console.warn(`⚠️ [${modelName}] Erro: ${error.message}`);
                if (modelName === MODEL_PRIORITY[MODEL_PRIORITY.length - 1]) throw error;
                await this.sleep(1000);
            }
        }
    }
}

module.exports = new AssistantService();
