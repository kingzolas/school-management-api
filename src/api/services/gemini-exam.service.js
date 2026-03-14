// src/api/services/gemini-exam.service.js

const { genAI } = require('../../config/gemini');

class GeminiExamService {
  async generateQuestions({ topic, count = 5, gradeLevel, type = 'OBJECTIVE' }) {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // Prompt limpo, garantindo que o exemplo de JSON seja um JSON 100% válido (sem comentários // dentro dele)
      const prompt = `
        Você é um professor especialista em criar avaliações escolares de alta qualidade.
        Sua tarefa é criar ${count} questões do tipo ${type} sobre o tema: "${topic}".
        O público-alvo são alunos do nível: "${gradeLevel}".

        REGRAS ABSOLUTAS:
        1. Você NÃO PODE responder com texto markdown, explicações ou saudações.
        2. Sua resposta deve ser EXATAMENTE um array JSON válido contendo as questões.
        3. O valor de "correctAnswer" DEVE ser apenas uma letra maiúscula: "A", "B", "C", "D" ou "E".
        4. Siga ESTRITAMENTE a estrutura de chaves abaixo, que reflete o banco de dados do sistema.

        Se o tipo for OBJECTIVE, a estrutura deve ser exatamente esta:
        [
          {
            "type": "OBJECTIVE",
            "text": "Enunciado claro e direto da questão?",
            "options": [
               "Alternativa incorreta 1.",
               "Alternativa correta.",
               "Alternativa incorreta 2.",
               "Alternativa incorreta 3.",
               "Alternativa incorreta 4."
            ],
            "correctAnswer": "B",
            "weight": 1.0
          }
        ]

        Se o tipo for DISSERTATIVE, a estrutura deve ser exatamente esta:
        [
          {
            "type": "DISSERTATIVE",
            "text": "Enunciado da questão dissertativa?",
            "linesToLeave": 5,
            "weight": 2.0
          }
        ]
      `;

      // 👇 A CORREÇÃO ESTÁ AQUI: O formato correto que a SDK do Google exige
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
        }
      });

      const responseText = result.response.text();
      
      return JSON.parse(responseText);

    } catch (error) {
      console.error('❌ Erro no GeminiExamService:', error);
      throw new Error('Falha ao gerar questões com a IA do Gemini.');
    }
  }
}

// Como você está usando "new" na chamada lá no Controller, exportamos a instância da classe!
module.exports = new GeminiExamService();