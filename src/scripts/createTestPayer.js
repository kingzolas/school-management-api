// Este script cria um NOVO usuário de teste (Payer/Comprador)
// associado à sua conta de teste (Collector/Vendedor).
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN_TEST;
const API_URL = 'https://api.mercadopago.com/users/test';

// O "site_id" do Brasil é "MLB" (Mercado Livre Brasil)
// "MLA" (do seu curl) é Argentina, o que poderia causar erros.
const testUserBody = {
  site_id: "MLB", 
  description: "Comprador de Teste para App Escola"
};

(async () => {
  console.log(`[Create Payer] Criando novo usuário de teste para o site ${testUserBody.site_id}...`);
  console.log(`[Create Payer] Usando Access Token: ${ACCESS_TOKEN ? ACCESS_TOKEN.substring(0, 15) : 'ERRO: TOKEN NÃO ENCONTRADO'}`);

  if (!ACCESS_TOKEN) {
    console.error("❌ ERRO: MP_ACCESS_TOKEN_TEST não encontrado no seu .env. Verifique o arquivo.");
    return;
  }

  try {
    // Usando fetch nativo do Node.js (você está no v20)
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'MercadoPago-SDK-Node-v3' // Boa prática
      },
      body: JSON.stringify(testUserBody)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ ERRO ao criar usuário de teste:');
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log('✅ SUCESSO! Usuário de teste criado:');
    console.log(JSON.stringify(data, null, 2));
    console.log('\n--- PRÓXIMO PASSO ---');
    console.log(`Copie este e-mail: ${data.email}`);
    console.log(`E cole no 'hardcodedTestEmail' dentro do 'invoice.service.js'!`);

  } catch (error) {
    console.error('❌ ERRO INESPERADO NO SCRIPT:', error.message);
  }
})();