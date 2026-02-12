const NotificationLog = require('../models/notification-log.model');
const Invoice = require('../models/invoice.model');
const School = require('../models/school.model');
const NotificationConfig = require('../models/notification-config.model');
const whatsappService = require('./whatsapp.service');
const cron = require('node-cron');
const mongoose = require('mongoose'); 

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

// Texto padrão para evitar cobranças indevidas por atraso de liquidação bancária
const AVISO_LIQUIDACAO = "\n\n_Obs: Se você já realizou o pagamento, por favor desconsidere esta mensagem. O banco pode levar até 3 dias úteis para processar a baixa em nosso sistema._";

const TEMPLATES_FUTURO = [
    `Olá {nome}! Tudo bem? 😊\nA *{escola}* está enviando a fatura referente a: *{descricao}*.\nEla vence em {vencimento}, mas já estamos adiantando para sua organização.\nValor: R$ {valor}.${AVISO_LIQUIDACAO}`,
    `Oi {nome}! A mensalidade de *{descricao}* da *{escola}* já está disponível para pagamento.\nVencimento: {vencimento}.\nSegue abaixo os dados:${AVISO_LIQUIDACAO}`,
    `{escola} Informa: Fatura disponível.\n📝 Referência: {descricao}\n💲 Total: R$ {valor}\n🗓️ Vencimento: {vencimento}.${AVISO_LIQUIDACAO}`
];

const TEMPLATES_HOJE = [
    `Bom dia {nome}! A *{escola}* lembra que sua mensalidade vence *HOJE* ({vencimento}).\nValor: R$ {valor}.\nSegue o link para pagamento:${AVISO_LIQUIDACAO}`,
    `Olá {nome}, hoje é o dia do vencimento da fatura da *{escola}*.\nReferente a: {descricao}\nTotal: R$ {valor}.\n\nSegue o código/link para pagamento rápido:${AVISO_LIQUIDACAO}`,
    `Oi! A *{escola}* passa para lembrar do pagamento de *{descricao}* que vence hoje. Copie o código ou acesse o link abaixo:${AVISO_LIQUIDACAO}`
];

const TEMPLATES_ATRASO = [
    `Olá {nome}, a *{escola}* notou que a fatura de *{descricao}* (vencida em {vencimento}) ainda consta como pendente.\nPodemos ajudar? Segue o link atualizado:${AVISO_LIQUIDACAO}`,
    `Oi {nome}! A mensalidade de {descricao} na *{escola}* passou do vencimento ({vencimento}).\nValor original: R$ {valor}.\nSegue os dados para regularização:${AVISO_LIQUIDACAO}`,
    `Lembrete *{escola}*: Consta em aberto a fatura de *{descricao}*.\nPara evitar juros, utilize o link abaixo para atualizar seu boleto:${AVISO_LIQUIDACAO}`
];

class NotificationService {
    
    constructor() {
        this.isProcessing = false;
    }

    /**
     * [CORRIGIDO] Estatísticas em Tempo Real
     */
    async getDailyStats(schoolId) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        let objectIdSchool;
        try {
            objectIdSchool = new mongoose.Types.ObjectId(schoolId);
        } catch (e) {
            console.error("ID da escola inválido para stats:", schoolId);
            return { queued: 0, processing: 0, sent: 0, failed: 0, total_today: 0 };
        }

        const stats = await NotificationLog.aggregate([
            {
                $match: {
                    school_id: objectIdSchool, 
                    updatedAt: { $gte: startOfDay, $lte: endOfDay }
                }
            },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);

        const result = {
            queued: 0,
            processing: 0,
            sent: 0,
            failed: 0,
            total_today: 0
        };

        stats.forEach(s => {
            if (result[s._id] !== undefined) {
                result[s._id] = s.count;
            }
        });

        result.total_today = result.queued + result.processing + result.sent + result.failed;
        
        return result;
    }

    /**
     * Previsão de Futuro (Dry Run)
     */
    async getForecast(schoolId, targetDate) {
        const simData = new Date(targetDate);
        simData.setHours(12, 0, 0, 0); 

        const limitPassado = new Date(simData); 
        limitPassado.setDate(limitPassado.getDate() - 60);
        limitPassado.setHours(0,0,0,0);
        
        const futuroLimit = new Date(simData);
        futuroLimit.setDate(futuroLimit.getDate() + 5);
        futuroLimit.setHours(23,59,59,999);

        const invoices = await Invoice.find({
            school_id: schoolId,
            status: 'pending',
            dueDate: { $gte: limitPassado, $lte: futuroLimit }
        }).select('dueDate value description student tutor status');

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
            const check = this._checkEligibilityForDate(inv.dueDate, simData);
            if (check.shouldSend) {
                forecast.total_expected++;
                forecast.breakdown[check.type]++;
            }
        }

        return forecast;
    }

    _checkEligibilityForDate(dueDate, referenceDate) {
        const ref = new Date(referenceDate); ref.setHours(0,0,0,0);
        const venc = new Date(dueDate); venc.setHours(0,0,0,0);
        
        const diffTime = venc - ref;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 3) return { shouldSend: true, type: 'reminder' };
        if (diffDays === 0) return { shouldSend: true, type: 'due_today' };
        if (diffDays < 0 && diffDays >= -60) return { shouldSend: true, type: 'overdue' };

        return { shouldSend: false, type: null };
    }

    isEligibleForSending(dueDate) {
        const check = this._checkEligibilityForDate(dueDate, new Date());
        return check.shouldSend;
    }

    async queueNotification({ schoolId, invoiceId, studentName, tutorName, phone, type = 'new_invoice' }) {
        try {
            const exists = await NotificationLog.exists({
                invoice_id: invoiceId, 
                type: type, 
                status: { $in: ['queued', 'processing'] }
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
                if (currentMinutes < (startH * 60 + startM) || currentMinutes >= (endH * 60 + endM)) continue;

                const schoolId = config.school_id;

                const hojeStart = new Date(); hojeStart.setHours(0,0,0,0);
                const hojeEnd = new Date(); hojeEnd.setHours(23,59,59,999);
                
                const limitPassado = new Date(); limitPassado.setDate(limitPassado.getDate() - 60); limitPassado.setHours(0,0,0,0);
                
                const futuroStart = new Date(); futuroStart.setDate(futuroStart.getDate() + 3); futuroStart.setHours(0,0,0,0);
                const futuroEnd = new Date(); futuroEnd.setDate(futuroEnd.getDate() + 3); futuroEnd.setHours(23,59,59,999);

                const invoices = await Invoice.find({
                    school_id: schoolId, 
                    status: 'pending', 
                    $or: [
                        { dueDate: { $gte: limitPassado, $lte: hojeEnd } }, 
                        { dueDate: { $gte: futuroStart, $lte: futuroEnd } } 
                    ]
                }).populate('student').populate('tutor');

                console.log(`📊 Escola ${schoolId}: ${invoices.length} faturas potenciais.`);

                for (const inv of invoices) {
                    const check = this._checkEligibilityForDate(inv.dueDate, new Date());
                    
                    if (check.shouldSend) {
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
                
                if (appEmitter) appEmitter.emit('notification:updated', log);

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
                if (appEmitter) appEmitter.emit('notification:updated', finalLog);
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
            console.log(`⚠️ [Zap] Banco desconectado. Verificando API...`);
            const isReallyConnected = await whatsappService.ensureConnection(log.school_id);
            if (!isReallyConnected) {
                throw new Error("WhatsApp desconectado (Confirmado pela API).");
            }
            console.log(`✅ [Zap] Conexão ativa na API. Prosseguindo...`);
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

        // 1. Envia Texto
        await whatsappService.sendText(log.school_id, log.target_phone, text);
        await new Promise(r => setTimeout(r, 2000));

        // 2. Envia Boleto/PDF se for Cora
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
        } 
        // 3. Envia Pix se for MercadoPago
        else if (invoice.gateway === 'mercadopago') {
            const pix = invoice.pix_code || invoice.mp_pix_copia_e_cola;
            if (pix) {
                await whatsappService.sendText(log.school_id, log.target_phone, "💠 Pix Copia e Cola:");
                await whatsappService.sendText(log.school_id, log.target_phone, pix);
            }
        }
    }

    // --- MÉTODOS ALTERADOS/ADICIONADOS ---

    async getLogs(schoolId, status, page = 1, limit = 20) {
        const query = { school_id: schoolId };
        if (status && status !== 'Todos') query.status = status;
        
        let dbQuery = NotificationLog.find(query).sort({ createdAt: -1 });

        // MODIFICAÇÃO: Permite limit=0 ou 'all' para trazer tudo
        const shouldPaginate = limit && limit !== 'all' && Number(limit) > 0;

        if (shouldPaginate) {
            const skip = (page - 1) * limit;
            dbQuery = dbQuery.skip(skip).limit(parseInt(limit));
        }

        const logs = await dbQuery.lean();
        const total = await NotificationLog.countDocuments(query);
        
        // Ajusta cálculo de páginas
        const pages = shouldPaginate ? Math.ceil(total / limit) : 1;
        
        return { logs, total, pages };
    }

    /**
     * [NOVO] Reenviar todas as falhas do dia
     */
    async retryAllFailed(schoolId) {
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);

        // Busca logs que falharam HOJE
        const failedLogs = await NotificationLog.find({
            school_id: schoolId,
            status: 'failed',
            updatedAt: { $gte: startOfDay, $lte: endOfDay }
        });

        if (failedLogs.length === 0) {
            return { count: 0, message: "Nenhuma falha encontrada hoje." };
        }

        let count = 0;
        for (const log of failedLogs) {
            log.status = 'queued';
            log.error_message = null; 
            log.scheduled_for = new Date(); 
            
            await log.save();
            
            // Avisa Front
            if (appEmitter) appEmitter.emit('notification:updated', log);
            
            count++;
        }

        console.log(`🔄 [Bulk Retry] ${count} mensagens re-enfileiradas.`);
        return { count, message: `${count} mensagens enviadas para a fila novamente.` };
    }
    
    // --- FIM DOS MÉTODOS ALTERADOS ---

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