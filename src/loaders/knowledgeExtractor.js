// src/loaders/knowledgeExtractor.js
const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIGURAÇÕES
// =============================================================================
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const MODELS_DIR = path.join(PROJECT_ROOT, 'src/api/models');
const SERVICES_DIR = path.join(PROJECT_ROOT, 'src/api/services');
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'src/config/knowledge_base.json');

console.log('🚀 Iniciando Extração (Modo Cirúrgico com Bracket Counting)...');

/**
 * Função Auxiliar: Extrai o bloco de texto do Schema respeitando chaves aninhadas
 */
function extractSchemaBody(fileContent) {
    // Procura onde começa a definição do Schema
    const startRegex = /new\s+(?:mongoose\.)?Schema\s*\(\s*\{/g;
    const match = startRegex.exec(fileContent);

    if (!match) return null;

    // O índice onde começa o PRIMEIRO '{' do objeto do schema
    const startIndex = match.index + match[0].length - 1; 
    
    let braceCount = 0;
    let endIndex = -1;

    // Percorre caractere por caractere para achar o fechamento correto
    for (let i = startIndex; i < fileContent.length; i++) {
        const char = fileContent[i];
        
        if (char === '{') {
            braceCount++;
        } else if (char === '}') {
            braceCount--;
        }

        // Se zerou, achamos o fechamento do objeto principal
        if (braceCount === 0) {
            endIndex = i;
            break;
        }
    }

    if (endIndex !== -1) {
        // Retorna o conteúdo ENTRE as chaves { ... }
        return fileContent.substring(startIndex + 1, endIndex);
    }
    
    return null;
}

// =============================================================================
// 1. EXTRATOR DE MODELOS
// =============================================================================
function extractModels() {
    const models = [];
    
    if (!fs.existsSync(MODELS_DIR)) {
        console.error(`❌ Pasta não encontrada: ${MODELS_DIR}`);
        return [];
    }

    const files = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.js'));

    files.forEach(file => {
        const content = fs.readFileSync(path.join(MODELS_DIR, file), 'utf-8');
        const modelName = file.replace('.model.js', '');
        
        // USA A NOVA LÓGICA DE CONTAGEM DE CHAVES
        const schemaBody = extractSchemaBody(content);
        
        if (schemaBody) {
            const fields = [];

            // Separa por linhas para facilitar a leitura de comentários
            const lines = schemaBody.split('\n');
            
            // Regex para pegar o nome do campo no inicio da linha (chave:)
            // Pega "student:", "value:", "status:"
            const keyRegex = /^\s*(\w+)\s*:/;

            lines.forEach((line, index) => {
                const trimmed = line.trim();
                // Ignora linhas que não começam com chave ou são comentários puros
                if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

                const keyMatch = trimmed.match(keyRegex);
                
                if (keyMatch) {
                    const fieldName = keyMatch[1];
                    
                    // Agora olhamos "ao redor" dessa linha para achar metadados
                    // (Simulação simples de contexto)
                    
                    // Tenta achar o tipo na mesma linha ou nas próximas 5 linhas
                    let contextChunk = lines.slice(index, index + 6).join(' ');
                    
                    // Limpeza básica para remover quebras de linha e espaços extras do chunk
                    contextChunk = contextChunk.replace(/\s+/g, ' ');

                    let type = 'String (Default)'; // Fallback
                    let description = '';
                    let enumValues = '';

                    // Detectar Tipo
                    if (contextChunk.includes('Schema.Types.ObjectId') || contextChunk.includes('mongoose.Schema.Types.ObjectId')) type = 'ObjectId';
                    else if (contextChunk.includes('String')) type = 'String';
                    else if (contextChunk.includes('Number')) type = 'Number';
                    else if (contextChunk.includes('Boolean')) type = 'Boolean';
                    else if (contextChunk.includes('Date')) type = 'Date';

                    // Detectar Referência (Ref)
                    const refMatch = contextChunk.match(/ref:\s*['"](\w+)['"]/);
                    if (refMatch) type = `Ref<${refMatch[1]}>`;

                    // Detectar Enum
                    const enumMatch = contextChunk.match(/enum:\s*\[([^\]]+)\]/);
                    if (enumMatch) {
                        const cleanEnums = enumMatch[1].replace(/['"]/g, '').trim();
                        enumValues = ` [Opções: ${cleanEnums}]`;
                    }

                    // Detectar Comentários (// ...) na mesma linha original
                    const commentMatch = line.match(/\/\/\s*(.*)/);
                    if (commentMatch) {
                        description = `-> ${commentMatch[1].trim()}`;
                    }

                    // [AJUSTE CRÍTICO] Se for Invoice e campo value, força descrição se não achou
                    if (modelName === 'invoice' && fieldName === 'value' && !description) {
                         description = "-> Valor em CENTAVOS";
                    }

                    fields.push({
                        field: fieldName,
                        type: type,
                        desc: (description + enumValues).trim()
                    });
                }
            });

            // Adiciona campos "escondidos" (timestamps) se detectar a opção
            if (content.includes('timestamps: true')) {
                fields.push({ field: 'createdAt', type: 'Date', desc: 'Auto-gerado' });
                fields.push({ field: 'updatedAt', type: 'Date', desc: 'Auto-gerado' });
            }

            models.push({
                name: modelName.charAt(0).toUpperCase() + modelName.slice(1),
                fields: fields
            });
        }
    });

    console.log(`✅ Modelos processados: ${models.length}`);
    return models;
}

// =============================================================================
// 2. EXTRATOR DE SERVIÇOS
// =============================================================================
function extractServices() {
    if (!fs.existsSync(SERVICES_DIR)) return [];
    const services = [];
    const files = fs.readdirSync(SERVICES_DIR).filter(f => f.endsWith('.js'));

    files.forEach(file => {
        const content = fs.readFileSync(path.join(SERVICES_DIR, file), 'utf-8');
        const serviceName = file.replace('.service.js', '');
        const regex = /\/\*\*([\s\S]*?)\*\/\s*(?:async\s+)?(\w+)\s*\(/g;
        let match;
        const methods = [];
        
        while ((match = regex.exec(content)) !== null) {
            const cleanDoc = match[1].split('\n')
                .map(l => l.replace(/\s*\*\s?/, '').trim())
                .filter(l => l && !l.startsWith('@')).join(' ');
            methods.push({ method: match[2], description: cleanDoc });
        }
        if (methods.length > 0) services.push({ service: serviceName, methods: methods });
    });
    console.log(`✅ Serviços processados: ${services.length}`);
    return services;
}

// =============================================================================
// 3. GERAR ARQUIVO
// =============================================================================
function generate() {
    const models = extractModels();
    const services = extractServices();

    let outputText = "=== BANCO DE DADOS (SCHEMA REAL ATUALIZADO) ===\n";
    
    // Verificação de segurança para debug do usuário
    const invoiceModel = models.find(m => m.name === 'Invoice');
    if (invoiceModel) {
        console.log("🔍 [DEBUG] Campos detectados no Invoice:", invoiceModel.fields.map(f => f.field).join(', '));
    } else {
        console.warn("⚠️ [DEBUG] Modelo Invoice NÃO detectado!");
    }

    models.forEach(m => {
        outputText += `TABLE: ${m.name}\n`;
        m.fields.forEach(f => {
            outputText += `- ${f.field} (${f.type}) ${f.desc}\n`;
        });
        outputText += "\n";
    });

    const finalJson = {
        updatedAt: new Date().toISOString(),
        rawText: outputText,
        structured: { models, services }
    };

    const dir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalJson, null, 2));
    console.log(`💾 Base de conhecimento salva em: ${OUTPUT_FILE}`);
}

try {
    generate();
} catch (e) {
    console.error("Erro:", e);
}