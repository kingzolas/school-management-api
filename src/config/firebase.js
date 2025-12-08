const admin = require("firebase-admin");
const fs = require('fs');
const path = require('path');

// 1. Tenta pegar o caminho da variável de ambiente (Produção no Render)
// 2. Se não tiver, assume que está local ("./serviceAccountKey.json")
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'serviceAccountKey.json');

console.log(`🔥 Inicializando Firebase com arquivo em: ${serviceAccountPath}`);

try {
    // Lê o arquivo do disco (seja local ou no /etc/secrets do Render)
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    console.log("✅ Firebase Admin inicializado com sucesso!");
} catch (error) {
    console.error("❌ Erro fatal ao ler serviceAccountKey:", error.message);
    // Não damos throw aqui para não crashar o servidor imediatamente, mas as notificações não funcionarão
}

module.exports = admin;