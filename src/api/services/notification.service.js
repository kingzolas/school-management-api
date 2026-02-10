const NotificationLog = require('../models/notification-log.model');
const Invoice = require('../models/invoice.model');
const School = require('../models/school.model');
const NotificationConfig = require('../models/notification-config.model');
const whatsappService = require('./whatsapp.service');
const cron = require('node-cron');

// --- IMPORTAÇÃO SEGURA DO EVENT EMITTER ---
let appEmitter;
try {
    appEmitter = require('../../config/eventEmitter'); 
} catch (e) {
    try {
        appEmitter = require('../../loaders/eventEmitter');
    } catch (e2) {
        console.warn("⚠️ appEmitter não encontrado.");
    }
}

const TEMPLATES_FUTURO = [
    "Olá {nome}! Tudo bem? 😊\nA *{escola}* está enviando a fatura referente a: *{descricao}*.\nEla vence apenas em {vencimento}, mas já estamos adiantando.\nValor: R$ {valor}.",
    "Oi {nome}! A mensalidade de *{descricao}* da *{escola}* já está disponível.\nVencimento: {vencimento}.\nSegue abaixo para quando precisar:",
    "{escola} Informa: Fatura disponível.\n📝 Referência: {descricao}\n💲 Total: R$ {valor}\n🗓️ Vencimento: {vencimento} (Ainda no prazo)."
];

const TEMPLATES_HOJE = [
    "Bom dia {nome}! A *{escola}* lembra que a mensalidade vence *HOJE* ({vencimento}).\nValor: R$ {valor}.\nEvite juros realizando o pagamento pelo link abaixo:",
    "Olá {nome}, hoje é o dia do vencimento da fatura da *{escola}*.\nReferente a: {descricao}\nTotal: R$ {valor}.\n\nSegue o código/link para pagamento rápido:",
    "Oi! A *{escola}* passa para lembrar do pagamento referente a *{descricao}* que vence hoje.\n\nCopie o código ou acesse o link abaixo:"
];

const TEMPLATES_ATRASO = [
    "Olá {nome}, a *{escola}* notou que a fatura de *{descricao}* (vencida em {vencimento}) está em aberto.\nPodemos ajudar? Segue o link atualizado:",
    "Oi {nome}! A mensalidade de {descricao} na *{escola}* passou do vencimento ({vencimento}).\nValor original: R$ {valor}.\nSegue os dados para regularização:",
    "Lembrete *{escola}*: Consta em aberto a fatura de *{descricao}*.\nPara evitar bloqueios ou mais juros, utilize o link abaixo:"
];

class NotificationService {
    
    constructor() {
        this.isProcessing = false;
    }

    /**
     * [CORRIGIDO] Estatísticas em Tempo Real com Debug
     * Retorna o resumo exato do dia (sem paginação).
     */
    async getDailyStats(schoolId) {
        // Truque para garantir o dia inteiro UTC
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        console.log(`📊 [Stats] Buscando logs da escola ${schoolId} entre: ${start.toISOString()} e ${end.toISOString()}`);

        const stats = await NotificationLog.aggregate([
            {
                $match: {
                    school_id: schoolId,
                    // Filtra pela data de criação ou atualização HOJE
                    updatedAt: { $gte: start, $lte: end }
                }
            },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);

        console.log("📊 [Stats] Resultado bruto do Banco:", stats);

        const result = {
            queued: 0,
            processing: 0,
            sent: 0,
            failed: 0,
            total_today: 0
        };

        stats.forEach(s => {
            if (result[s._id] !== undefined) result[s._id] = s.count;
        });

        result.total_today = result.queued + result.processing + result.sent + result.failed;
        
        return result;
    }

    /**
     * [CORRIGIDO] Previsão de Futuro (Dry Run) com Debug Extenso
     * Simula o que o sistema faria em uma data específica.
     */
    async getForecast(schoolId, targetDate) {
        // Normaliza a data alvo (ex: Amanhã)
        // Usa meio-dia para evitar problemas de borda de fuso horário
        const simData = new Date(targetDate);
        simData.setHours(12, 0, 0, 0);

        console.log(`🔮 [Forecast] Iniciando simulação para DATA BASE: ${simData.toISOString().split('T')[0]}`);

        // 1. Define limites ampliados para garantir que ache tudo
        // Olha até 90 dias para trás (para pegar atrasados antigos)
        const limitPassado = new Date(simData);
        limitPassado.setDate(limitPassado.getDate() - 90);
        limitPassado.setHours(0,0,0,0);

        // Olha até 5 dias para frente (para pegar lembretes futuros)
        const futuroLimit = new Date(simData);
        futuroLimit.setDate(futuroLimit.getDate() + 5);
        futuroLimit.setHours(23,59,59,999);

        console.log(`🔎 [Forecast] Query intervalo ampliado: ${limitPassado.toISOString()} até ${futuroLimit.toISOString()}`);

        // 2. Busca faturas PENDENTES neste intervalo grande
        // IMPORTANTE: Verifique se o status no banco é 'pending', 'open' ou 'aberta'
        const invoices = await Invoice.find({
            school_id: schoolId,
            status: 'pending', // <--- PONTO DE ATENÇÃO: Se seu banco usa outro status, mude aqui
            dueDate: { $gte: limitPassado, $lte: futuroLimit }
        }).select('dueDate value description student tutor status').populate('student', 'fullName').populate('tutor', 'fullName');

        console.log(`🔎 [Forecast] Total de faturas 'pending' encontradas no intervalo: ${invoices.length}`);

        // 3. Processa a lógica (Simulação)
        const forecast = {
            date: simData,
            total_expected: 0,
            breakdown: {
                due_today: 0,
                overdue: 0,
                reminder: 0
            }
        };

        for (const inv of invoices) {
            // Usa helper de elegibilidade passando a DATA SIMULADA como "hoje"
            const check = this._checkEligibilityForDate(inv.dueDate, simData);
            
            if (check.shouldSend) {
                // Descomente para ver detalhe de quem seria cobrado
                // console.log(`   -> Simulação: Cobraria ${inv.student?.fullName} (${check.type}) - Venc: ${inv.dueDate.toISOString().split('T')[0]}`);
                forecast.total_expected++;
                forecast.breakdown[check.type]++;
            }
        }

        console.log(`✅ [Forecast] Resultado final da simulação:`, forecast.breakdown);
        return forecast;
    }

    /**
     * Helper: Verifica elegibilidade baseada em uma data de referência (hoje ou simulada)
     */
    _checkEligibilityForDate(dueDate, referenceDate) {
        // Normaliza ambas as datas para 00:00:00 UTC para comparação justa de dias
        const ref = new Date(referenceDate); ref.setHours(0,0,0,0);
        const venc = new Date(dueDate); venc.setHours(0,0,0,0);
        
        // Diferença em milissegundos
        const diffTime = venc - ref;
        // Diferença em dias inteiros
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Regra 1: Lembrete (3 dias antes)
        if (diffDays === 3) return { shouldSend: true, type: 'reminder' };
        
        // Regra 2: Hoje (Dia exato)
        if (diffDays === 0) return { shouldSend: true, type: 'due_today' };
        
        // Regra 3: Atrasado (Ontem até 60 dias atrás)
        if (diffDays < 0 && diffDays >= -60) return { shouldSend: true, type: 'overdue' };

        return { shouldSend: false, type: null };
    }

    // --- MANTIDO PARA COMPATIBILIDADE ---
    isEligibleForSending(dueDate) {
        const check = this._checkEligibilityForDate(dueDate, new Date());
        return check.shouldSend;
    }

    async queueNotification({ schoolId, invoiceId, studentName, tutorName, phone, type = 'new_invoice' }) {
        try {
            const exists = await NotificationLog.exists({
                invoice_id: invoiceId, type: type, status: { $in: ['queued', 'processing'] }
            });

            if (exists) return;

            const newLog = await NotificationLog.create({
                school_id: schoolId,
                invoice_id: invoiceId,
                student_name: studentName,
                tutor_name: tutorName,
                target_phone: phone,
                type: type,
                status: 'queued',
                scheduled_for: new Date()
            });
            
            console.log(`📥 [Fila] + ADICIONADO: ${studentName} (${type})`);
            
            if (appEmitter && typeof appEmitter.emit === 'function') {
                appEmitter.emit('notification:created', newLog);
            }

        } catch (error) {
            console.error('❌ Erro ao enfileirar:', error);
        }
    }

    async scanAndQueueInvoices() {
        console.log('🔎 [Cron] INICIANDO VARREDURA INTELIGENTE');
        try {
            const activeConfigs = await NotificationConfig.find({ isActive: true });
            if (!activeConfigs.length) return;

            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();

            for (const config of activeConfigs) {
                const [startH, startM] = config.windowStart.split(':').map(Number);
                const [endH, endM] = config.windowEnd.split(':').map(Number);
                // Verifica janela de tempo
                if (currentMinutes < (startH * 60 + startM) || currentMinutes >= (endH * 60 + endM)) {
                    // console.log(`⏳ Escola ${config.school_id}: Fora da janela de envio.`);
                    continue;
                }

                const schoolId = config.school_id;

                // Datas reais de HOJE para varredura
                const hojeStart = new Date(); hojeStart.setHours(0,0,0,0);
                const hojeEnd = new Date(); hojeEnd.setHours(23,59,59,999);
                
                const limitPassado = new Date(); limitPassado.setDate(limitPassado.getDate() - 60); limitPassado.setHours(0,0,0,0);
                
                const futuroStart = new Date(); futuroStart.setDate(futuroStart.getDate() + 3); futuroStart.setHours(0,0,0,0);
                const futuroEnd = new Date(); futuroEnd.setDate(futuroEnd.getDate() + 3); futuroEnd.setHours(23,59,59,999);

                // Busca faturas elegíveis
                const invoices = await Invoice.find({
                    school_id: schoolId, 
                    status: 'pending', 
                    $or: [
                        { dueDate: { $gte: limitPassado, $lte: hojeEnd } }, 
                        { dueDate: { $gte: futuroStart, $lte: futuroEnd } } 
                    ]
                }).populate('student').populate('tutor');

                console.log(`📊 [Cron] Escola ${schoolId}: ${invoices.length} faturas potenciais encontradas.`);

                for (const inv of invoices) {
                    // Verificação real com a data de HOJE
                    const check = this._checkEligibilityForDate(inv.dueDate, new Date());
                    
                    if (check.shouldSend) {
                        // Verifica se JÁ enviou hoje
                        const sentToday = await NotificationLog.exists({
                            invoice_id: inv._id,
                            createdAt: { $gte: hojeStart } 
                        });

                        if (!sentToday) {
                            await this._prepareAndQueue(inv, check.type);
                        }
                    }
                }
            }
        } catch (e) {
            console.error("❌ Erro varredura:", e);
        }
    }

    async _prepareAndQueue(invoice, type) {
        let name, phone;
        if (invoice.tutor) { name = invoice.tutor.fullName; phone = invoice.tutor.phoneNumber || invoice.tutor.telefone; }
        else if (invoice.student) { name = invoice.student.fullName; phone = invoice.student.phoneNumber; }

        if (name && phone) {
            await this.queueNotification({
                schoolId: invoice.school_id, invoiceId: invoice._id, studentName: invoice.student?.fullName || 'Aluno',
                tutorName: name, phone: phone, type: type
            });
        }
    }

    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const logs = await NotificationLog.find({
                status: 'queued', scheduled_for: { $lte: new Date() }
            }).limit(1).populate('invoice_id'); 

            if (logs.length > 0) console.log(`🔄 Processando lote de ${logs.length}...`);

            for (const log of logs) {
                log.status = 'processing';
                await log.save();
                
                if (appEmitter && typeof appEmitter.emit === 'function') {
                    appEmitter.emit('notification:updated', log);
                }

                try {
                    const delay = Math.floor(Math.random() * 15000) + 15000;
                    console.log(`⏳ Aguardando ${Math.floor(delay/1000)}s...`);
                    await new Promise(r => setTimeout(r, delay));

                    await this._sendSingleNotification(log);
                    
                    log.status = 'sent';
                    log.sent_at = new Date();
                    log.error_message = null;
                    console.log(`✅ [Zap] Enviado: ${log.tutor_name}`);

                } catch (error) {
                    let friendlyError = error.message;
                    if (error.response?.data?.response?.message?.[0]?.exists === false) {
                        friendlyError = "Número inválido/Sem WhatsApp.";
                    }
                    console.error(`❌ [Zap] Falha: ${log.tutor_name}`, friendlyError);
                    log.status = 'failed';
                    log.error_message = friendlyError;
                    log.attempts += 1;
                }
                
                const finalLog = await log.save();
                if (appEmitter && typeof appEmitter.emit === 'function') {
                    appEmitter.emit('notification:updated', finalLog);
                }
            }
        } catch (err) {
            console.error('Erro fila:', err);
        } finally {
            this.isProcessing = false;
        }
    }

    async _sendSingleNotification(log) {
        const invoice = log.invoice_id;
        if (!invoice) throw new Error("Fatura não encontrada.");
        if (invoice.status === 'paid' || invoice.status === 'canceled') throw new Error("Fatura já paga/cancelada.");

        const school = await School.findById(log.school_id).select('name whatsapp').lean();
        const nomeEscola = school.name || "Escola";

        if (!school.whatsapp || school.whatsapp.status !== 'connected') {
            console.log(`⚠️ [Zap] Banco diz 'disconnected'. Verificando status real na API...`);
            const isReallyConnected = await whatsappService.ensureConnection(log.school_id);
            if (!isReallyConnected) {
                throw new Error("WhatsApp desconectado (Confirmado pela API).");
            }
            console.log(`✅ [Zap] Conexão recuperada! A API estava online. Prosseguindo envio...`);
        }

        const hoje = new Date(); hoje.setHours(0,0,0,0);
        const venc = new Date(invoice.dueDate); venc.setHours(0,0,0,0);
        const diff = (venc - hoje) / (1000 * 60 * 60 * 24);

        let list = TEMPLATES_HOJE;
        if (diff > 0) list = TEMPLATES_FUTURO;
        else if (diff < 0) list = TEMPLATES_ATRASO;

        const text = list[Math.floor(Math.random() * list.length)]
            .replace('{escola}', nomeEscola)
            .replace('{nome}', log.tutor_name.split(' ')[0])
            .replace('{descricao}', invoice.description)
            .replace('{valor}', (invoice.value/100).toFixed(2).replace('.',','))
            .replace('{vencimento}', venc.toLocaleDateString('pt-BR', {timeZone: 'UTC'}));

        await whatsappService.sendText(log.school_id, log.target_phone, text);
        await new Promise(r => setTimeout(r, 2000));

        if (invoice.gateway === 'cora' && invoice.boleto_url) {
            try {
                const safeName = log.student_name.split(' ')[0].replace(/[^a-zA-Z0-9]/g, '_');
                const fileName = `Boleto_${safeName}.pdf`;
                console.log(`📎 [Zap] Enviando PDF: ${fileName}`);
                await whatsappService.sendFile(
                    log.school_id, log.target_phone, invoice.boleto_url, fileName, "📄 Segue o seu boleto." 
                );
            } catch (e) {
                console.error("⚠️ Falha PDF:", e.message);
                await whatsappService.sendText(log.school_id, log.target_phone, `📄 Baixe aqui: ${invoice.boleto_url}`);
            }
            if (invoice.boleto_barcode) {
                await whatsappService.sendText(log.school_id, log.target_phone, invoice.boleto_barcode);
            }
        } else if (invoice.gateway === 'mercadopago') {
            const pix = invoice.pix_code || invoice.mp_pix_copia_e_cola;
            if (pix) {
                await whatsappService.sendText(log.school_id, log.target_phone, "💠 Pix Copia e Cola:");
                await whatsappService.sendText(log.school_id, log.target_phone, pix);
            }
        }
    }

    async getLogs(schoolId, status, page = 1) {
        const query = { school_id: schoolId };
        if (status && status !== 'Todos') query.status = status;
        const limit = 20; const skip = (page - 1) * limit;
        const logs = await NotificationLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
        const total = await NotificationLog.countDocuments(query);
        return { logs, total, pages: Math.ceil(total / limit) };
    }
    
    async getConfig(schoolId) {
        let config = await NotificationConfig.findOne({ school_id: schoolId });
        if (!config) config = await NotificationConfig.create({ school_id: schoolId });
        return config;
    }
    
    async saveConfig(schoolId, data) {
        return await NotificationConfig.findOneAndUpdate({ school_id: schoolId }, data, { new: true, upsert: true });
    }
}

const service = new NotificationService();
cron.schedule('* * * * *', () => { service.processQueue(); });
cron.schedule('0 * * * *', () => { service.scanAndQueueInvoices(); });
module.exports = service;