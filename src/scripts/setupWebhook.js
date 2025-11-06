// // Este script é usado para registrar a URL do seu webhook na Efí via API.
// // Você só precisa rodar isso UMA VEZ ou sempre que sua URL do ngrok mudar.
// const path = require('path');
// const EfiPay = require('sdk-node-apis-efi');
// // [CORREÇÃO 1] Corrigir o caminho do dotenv para ser absoluto
// require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
// const fs = require('fs');


// // --- 1. A URL que a Efí deve chamar ---
// // (A URL que você pegou do ngrok + a rota do seu webhook.controller.js)
// const NGROK_URL = 'https://weightiest-ironically-marta.ngrok-free.dev'; // Substitua se o ngrok reiniciar
// const WEBHOOK_ROUTE = '/api/webhook/efi';
// const fullWebhookUrl = `${NGROK_URL}${WEBHOOK_ROUTE}`;

// // --- 2. Configuração da Efí (Exatamente como em invoice.service.js) ---
// const certPath = path.resolve(__dirname, '../config/certs/homologacao.p12');
// const isSandbox = process.env.EFI_SANDBOX === 'true';

// // [DEBUG ADICIONAL] Vamos verificar as chaves do .env
// console.log(`[Config Webhook] Tentando registrar URL: ${fullWebhookUrl}`);
// console.log(`[Config Webhook] Usando Chave Pix: ${process.env.EFI_PIX_KEY}`);
// console.log(`[Config Webhook] Usando Client ID: ${process.env.EFI_CLIENT_ID_SANDBOX}`);
// console.log(`[Config Webhook] 'isSandbox' é: ${isSandbox}`);
// // Fim do Debug Adicional

// if (isSandbox && !fs.existsSync(certPath)) {
//   console.error(`❌ [Erro Fatal] Certificado de sandbox não encontrado em ${certPath}`);
//   process.exit(1); // Para a execução
// }

// // [CORREÇÃO 2] Usar a mesma configuração de 'efiOptions' que funcionou
// // em 'invoice.service.js'. A versão anterior estava errada.
// const efiOptions = {
//   sandbox: isSandbox, 
  
//   // DEVE incluir client_id e client_secret
//   client_id: isSandbox ? process.env.EFI_CLIENT_ID_SANDBOX : undefined,
//   client_secret: isSandbox ? process.env.EFI_CLIENT_SECRET_SANDBOX : undefined,
  
//   certificate: isSandbox ? certPath : undefined,
// };

// const efi = new EfiPay(efiOptions);

// // --- 3. A Função Principal (IIFE) ---
// (async () => {
//   try {
//     // [CORREÇÃO FINAL - A única combinação que resta]
//     // 1. FORÇAR o endpoint /.../{chave} passando os params
//     const params = {
//       chave: process.env.EFI_PIX_KEY,
//     };

//     // 2. FORÇAR o body 'webhookUrl' que este endpoint espera
//     const body = {
//       webhookUrl: fullWebhookUrl,
//     };

//     console.log('[Config Webhook] Enviando requisição para a Efí (endpoint /{chave})...');
    
//     // Chama a função do SDK (que faz o PUT /v2/webhook/{chave})
//     const resposta = await efi.pixConfigWebhook(params, body);

//     console.log('✅ SUCESSO! Webhook registrado na Efí.');
//     console.log('Resposta da Efí:');
//     console.log(resposta); // Deve mostrar a URL e a chave

//   } catch (error) {
//     console.error('❌ ERRO ao registrar o webhook:');
//       console.error('--- [DEBUG INÍCIO DO ERRO EFÍ] ---');
//     console.log(JSON.stringify(error, null, 2));
//     console.error('--- [DEBUG FIM DO ERRO EFÍ] ---');
//     console.error(error.nome || error.message);
//     if (error.pilha) {
//       console.error(JSON.stringify(error.pilha, null, 2));
//     }
//     console.error('\nVerifique se a sua Chave Pix no .env está correta e se a URL do ngrok está ativa.');
//   }
// })();

