const NotificationLog = require('../models/notification-log.model');
const Invoice = require('../models/invoice.model');
const School = require('../models/school.model');
const NotificationConfig = require('../models/notification-config.model');
const whatsappService = require('./whatsapp.service');
const cron = require('node-cron');

// --- IMPORTAÇÃO SEGURA DO EVENT EMITTER ---
let appEmitter;
try {
    // Tenta importar do caminho padrão
    appEmitter = require('../../config/eventEmitter'); 
} catch (e) {
    try {
        // Tenta importar do caminho alternativo (loaders) que vi nos seus logs
        appEmitter = require('../../loaders/eventEmitter');
    } catch (e2) {
        console.warn("⚠️ appEmitter não encontrado. O WebSocket de notificações não funcionará.");
    }
}

// --- TEMPLATES ---
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
            
            // [WEBSOCKET] Dispara evento com verificação de segurança
            if (appEmitter && typeof appEmitter.emit === 'function') {
                appEmitter.emit('notification:created', newLog);
            }

        } catch (error) {
            console.error('❌ Erro ao enfileirar:', error);
        }
    }

    async scanAndQueueInvoices() {
        console.log('🔎 [Cron] INICIANDO VARREDURA DE FATURAS');
        try {
            const activeConfigs = await NotificationConfig.find({ isActive: true });
            if (!activeConfigs.length) return;

            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();

            for (const config of activeConfigs) {
                const [startH, startM] = config.windowStart.split(':').map(Number);
                const [endH, endM] = config.windowEnd.split(':').map(Number);
                const startMinutes = startH * 60 + startM;
                const endMinutes = endH * 60 + endM;

                if (currentMinutes < startMinutes || currentMinutes >= endMinutes) continue;

                const schoolId = config.school_id;

                // 1. Vence Hoje
                if (config.enableDueToday) {
                    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
                    const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);
                    const dueToday = await Invoice.find({
                        school_id: schoolId, status: 'pending', dueDate: { $gte: todayStart, $lte: todayEnd }
                    }).populate('student').populate('tutor');

                    for (const inv of dueToday) {
                        const sent = await NotificationLog.exists({
                            invoice_id: inv._id, type: { $in: ['reminder', 'new_invoice'] }, createdAt: { $gte: todayStart }
                        });
                        if (!sent) await this._prepareAndQueue(inv, 'reminder');
                    }
                }

                // 2. Atrasados (60 dias)
                if (config.enableOverdue) {
                    const limit = new Date(); limit.setDate(limit.getDate() - 60); limit.setHours(0,0,0,0);
                    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
                    const overdue = await Invoice.find({
                        school_id: schoolId, status: 'pending', dueDate: { $gte: limit, $lte: yesterday }
                    }).limit(50).populate('student').populate('tutor');

                    for (const inv of overdue) {
                        const sent = await NotificationLog.exists({ invoice_id: inv._id, type: 'overdue' });
                        if (!sent) await this._prepareAndQueue(inv, 'overdue');
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
            // Lote pequeno (1 a 3) para evitar bloqueio e garantir segurança
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
                    // [ANTI-BAN] Delay aleatório 15s a 30s
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

        // ==============================================================================
        // 🛡️ CORREÇÃO (AUTO-HEAL): Verifica a API se o banco disser que está offline
        // ==============================================================================
        if (!school.whatsapp || school.whatsapp.status !== 'connected') {
            console.log(`⚠️ [Zap] Banco diz 'disconnected'. Verificando status real na API...`);
            
            // Chama o ensureConnection que vai na Evolution checar o estado real
            // Se estiver 'open' lá, ele já atualiza o banco automaticamente e retorna true
            const isReallyConnected = await whatsappService.ensureConnection(log.school_id);
            
            if (!isReallyConnected) {
                // Se a API confirmar que está offline, aí sim lançamos o erro
                throw new Error("WhatsApp desconectado (Confirmado pela API).");
            }
            console.log(`✅ [Zap] Conexão recuperada! A API estava online. Prosseguindo envio...`);
        }
        // ==============================================================================

        // 2. Template Inteligente
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

        // 2. Envio Texto
        await whatsappService.sendText(log.school_id, log.target_phone, text);
        await new Promise(r => setTimeout(r, 2000));

        // 3. Envio Anexo (PDF ou Pix)
        if (invoice.gateway === 'cora' && invoice.boleto_url) {
            try {
                // Nome seguro para PDF
                const safeName = log.student_name.split(' ')[0].replace(/[^a-zA-Z0-9]/g, '_');
                const fileName = `Boleto_${safeName}.pdf`;

                console.log(`📎 [Zap] Enviando PDF: ${fileName}`);
                
                await whatsappService.sendFile(
                    log.school_id, 
                    log.target_phone, 
                    invoice.boleto_url, 
                    fileName,              
                    "📄 Segue o seu boleto." 
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