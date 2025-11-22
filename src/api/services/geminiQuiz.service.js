const { GoogleGenerativeAI } = require("@google/generative-ai");

// ==========================================================
// CONFIGURAÇÃO DE RESILIÊNCIA
// ==========================================================
// Prioridade: Tenta o Flash, se falhar vai pro Lite, se falhar vai pro Pro (mais caro/lento mas garante a entrega)
const MODEL_PRIORITY = [
    'gemini-2.5-flash',      
    'gemini-2.5-flash-lite', 
    'gemini-2.5-pro'         
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class GeminiQuizService {
    constructor() {
        // Inicializa o SDK
        // Certifique-se que process.env.GEMINI_API_KEY está definido no seu .env
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }

    /**
     * Gera o JSON do Quiz com sistema de Fallback/Retry
     */
    async generateQuizJson(topic, level, quantity, contextData = {}) {
        let lastError = null;

        // Loop de Tentativa (Flash -> Lite -> Pro)
        for (const modelName of MODEL_PRIORITY) {
            try {
                console.log(`[QUIZ-AI] Iniciando geração com modelo: ${modelName}`);

                const model = this.genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        responseMimeType: "application/json", // Força resposta JSON estruturada
                        temperature: 0.7 // Criatividade controlada
                    }
                });

                const prompt = `
                    Você é um assistente pedagógico especialista.
                    Crie um quiz escolar estruturado para um sistema LMS.
                    
                    PARÂMETROS:
                    - TEMA: "${topic}"
                    - NÍVEL DE DIFICULDADE: ${level}
                    - QUANTIDADE: ${quantity} questões
                    - CONTEXTO ADICIONAL: ${contextData.description || 'Nenhum'}

                    REGRAS ESTRUTURAIS OBRIGATÓRIAS (JSON):
                    Você DEVE retornar APENAS um Array de Objetos JSON válido. Não use Markdown (\`\`\`).
                    
                    Schema de cada objeto no Array:
                    {
                        "category": "String (Subtópico da questão)",
                        "question": "String (O enunciado da pergunta)",
                        "options": ["Opção A", "Opção B", "Opção C", "Opção D"],
                        "correctIndex": Inteiro (0, 1, 2 ou 3 - indicando qual opção é a correta),
                        "explanation": {
                            "correct": "String (Explicação didática do porquê a resposta está certa)",
                            "wrongs": [
                                "String (Por que a opção errada 1 está errada)",
                                "String (Por que a opção errada 2 está errada)",
                                "String (Por que a opção errada 3 está errada)"
                            ]
                        }
                    }
                    
                    DIRETRIZES PEDAGÓGICAS:
                    - Use Português do Brasil formal e acadêmico.
                    - As explicações dos erros ("wrongs") devem ser educativas, não apenas dizer "está errado".
                    - Evite ambiguidades nas opções.
                `;

                // Chamada à API
                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                
                // Validação imediata do JSON
                // Se o JSON estiver quebrado, vai cair no catch e tentar outro modelo
                const jsonResult = JSON.parse(text);

                console.log(`[QUIZ-AI] Sucesso com ${modelName}. Geradas ${jsonResult.length} questões.`);
                return jsonResult;

            } catch (error) {
                console.warn(`⚠️ [QUIZ-AI] Falha no modelo ${modelName}: ${error.message}`);
                lastError = error;

                // Verifica se é um erro recuperável (Sobrecarga ou JSON inválido)
                // Se for o último modelo da lista, não faz sleep, já vai jogar o erro final
                if (modelName !== MODEL_PRIORITY[MODEL_PRIORITY.length - 1]) {
                    console.log(`⏳ [QUIZ-AI] Aguardando 1s antes de tentar o próximo modelo...`);
                    await sleep(1000); 
                    continue; // Pula para o próximo modelo no loop
                }
            }
        }

        // Se saiu do loop, todos falharam
        console.error("[QUIZ-AI] Erro Crítico: Todos os modelos falharam.");
        throw new Error("O serviço de IA está indisponível no momento. Tente novamente em alguns instantes.");
    }
}

module.exports = new GeminiQuizService();