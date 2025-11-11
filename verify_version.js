// verify_version.js
const fs = require('fs');
const path = require('path');

try {
    // Constrói o caminho para o package.json DENTRO do node_modules
    const packagePath = path.join(
        __dirname, 
        'node_modules', 
        '@google', 
        'generative-ai', 
        'package.json'
    );

    console.log(`--- Verificando a versão real em: ---`);
    console.log(packagePath);
    console.log("---------------------------------");

    // Lê o arquivo
    const packageData = fs.readFileSync(packagePath, 'utf8');
    const version = JSON.parse(packageData).version;

    console.log(`✅ SUCESSO!`);
    console.log(`Seu package.json principal diz: 0.24.1`);
    console.log(`A versão REAL dentro do node_modules é: ${version}`);
    console.log("---------------------------------");

    if (version !== "0.24.1") {
        console.log("PROVA: As versões são DIFERENTES. Seu node_modules está corrompido.");
    } else {
        console.log("VEREDITO: As versões são iguais. O que é bizarro e indica que o pacote está corrompido de outra forma (arquivos misturados).");
    }

} catch (error) {
    console.error("❌ ERRO AO LER O PACOTE NO NODE_MODULES:");
    console.error(error.message);
    console.log("---------------------------------");
    console.log("PROVA: Se o arquivo nem existe, seu node_modules está 100% quebrado.");
}