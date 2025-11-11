// check_models.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("❌ ERRO: 'GEMINI_API_KEY' não encontrada no .env!");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listAvailableModels() {
    console.log("Conectando à API (usando método antigo 'listModels()')...");
    try {
        // --- A CORREÇÃO ESTÁ AQUI ---
        // O erro 'getModels is not a function' prova que estamos
        // em uma versão antiga do pacote. A função antiga era 'listModels()'.
        const { models } = await genAI.listModels(); // <<< MUDANÇA CRÍTICA

        console.log("--- Modelos Disponíveis para sua Chave (v1beta) ---");
        
        for (const model of models) {
            // A estrutura da resposta antiga também era diferente
            const name = model.name; // ex: 'models/gemini-pro'
            
            // Verifica se o modelo suporta a função 'generateContent'
            const supportsGenerateContent = model.supportedGenerationMethods.includes('generateContent');
            
            console.log(`
---------------------------------
Nome: ${name}
Display Name: ${model.displayName}
Suporta 'generateContent': ${supportsGenerateContent ? '✅ SIM' : '❌ NÃO'}
`);
        }
        console.log("---------------------------------");
        console.log("✅ Lista concluída.");

    } catch (error) {
        console.error("❌ ERRO AO TENTAR LISTAR OS MODELOS:");
        console.error(error);
    }
}

listAvailableModels();