// src/config/gemini.js

// --- 🚀 MUDANÇA: O nome da biblioteca mudou ---
const { GoogleGenerativeAI } = require('@google/generative-ai'); 

require('dotenv').config();
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ ERRO FATAL: 'GEMINI_API_KEY' não foi encontrada no .env!");
  throw new Error("Aplicação parada: GEMINI_API_KEY não definida.");
}

// --- 🚀 MUDANÇA: O nome da classe mudou ---
const genAI = new GoogleGenerativeAI(apiKey);

// Exportamos o CLIENTE (genAI), que tem a função .getGenerativeModel()
module.exports = { genAI };