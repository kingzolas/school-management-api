// src/api/services/invoice.service.js
const Invoice = require('../models/invoice.model.js');
const Student = require('../models/student.model.js');
const Tutor = require('../models/tutor.model.js');
const School = require('../models/school.model.js'); 
const whatsappService = require('./whatsapp.service.js');
const GatewayFactory = require('../gateways/gateway.factory.js');
const { v4: uuidv4 } = require('uuid'); 
const axios = require('axios');
const https = require('https');
const { PDFDocument } = require('pdf-lib');

// --- TEMPLATES DE MENSAGENS (COM NOME DA ESCOLA) ---

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

class InvoiceService {

  /**
   * Cria fatura (Mercado Pago ou Cora) e salva no banco
   */
  async createInvoice(invoiceData, schoolId) {
    const { studentId, value, dueDate, description, tutorId, gateway: chosenGateway } = invoiceData;

    // 1. Busca configurações
    const selectString = [
        '+mercadoPagoConfig.prodAccessToken',
        '+mercadoPagoConfig.prodClientId',
        '+mercadoPagoConfig.prodClientSecret',
        'coraConfig.isSandbox', 
        'coraConfig.sandbox.clientId',
        '+coraConfig.sandbox.certificateContent',
        '+coraConfig.sandbox.privateKeyContent',
        'coraConfig.production.clientId',
        '+coraConfig.production.certificateContent',
        '+coraConfig.production.privateKeyContent',
        'name' // [IMPORTANTE] Garantir que o nome da escola venha
    ].join(' ');

    const school = await School.findById(schoolId).select(selectString).lean(); 

    if (!school) throw new Error('Escola não encontrada.');

    // 2. Validações de Aluno
    const student = await Student.findOne({ _id: studentId, school_id: schoolId })
        .populate('financialTutorId');

    if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

    // 3. Limpeza Endereço
    const rawAddr = student.address || {};
    let cleanZip = (rawAddr.zipCode || rawAddr.cep || '').replace(/\D/g, '');
    
    if (cleanZip.length !== 8) {
        cleanZip = '01310100'; // Fallback
    }

    const cleanAddress = {
        street: rawAddr.street || 'Rua não informada',
        number: rawAddr.number || '0',
        district: rawAddr.neighborhood || rawAddr.district || 'Bairro',
        city: rawAddr.city || 'São Paulo',
        state: (rawAddr.state && rawAddr.state.length === 2) ? rawAddr.state : 'SP',
        zip_code: cleanZip 
    };

    // 4. Pagador
    let payerName, payerCpf, payerEmail, payerPhone;
    let linkedTutorId = null;

    if (student.financialResp === 'STUDENT') {
        if (!student.cpf) throw new Error('Aluno responsável sem CPF cadastrado.');
        payerName = student.fullName;
        payerCpf = student.cpf;
        payerEmail = student.email;
        payerPhone = student.phoneNumber;
        linkedTutorId = null;
    } else {
        let targetTutor = null;
        if (tutorId) {
            targetTutor = await Tutor.findOne({ _id: tutorId, school_id: schoolId });
        } else if (student.financialTutorId) {
            targetTutor = student.financialTutorId;
        }

        if (!targetTutor) throw new Error('Nenhum tutor responsável encontrado.');
        if (!targetTutor.cpf || targetTutor.cpf.length < 11) throw new Error('Tutor responsável sem CPF válido.');
        
        payerName = targetTutor.fullName;
        payerCpf = targetTutor.cpf;
        payerEmail = targetTutor.email;
        payerPhone = targetTutor.phoneNumber || targetTutor.telefone || targetTutor.celular;
        linkedTutorId = targetTutor._id;
    }

    // 5. Gateway e Payload
    const gateway = GatewayFactory.create(school, chosenGateway);
    const finalEmail = (payerEmail && payerEmail.includes('@')) 
        ? payerEmail 
        : "pagador_sem_email@academyhub.com"; 
    
    const tempId = new Invoice()._id; 

    const paymentPayload = {
        internalId: tempId, 
        value: value, 
        description: description,
        dueDate: dueDate,
        schoolId: schoolId,
        payer: {
            name: payerName,
            cpf: payerCpf,
            email: finalEmail,
            address: cleanAddress
        }
    };

    try {
      console.log(`[InvoiceService] Gerando cobrança via ${gateway.constructor.name}...`);
      
      const result = await gateway.createInvoice(paymentPayload);

      const newInvoice = new Invoice({
        _id: tempId,
        student: studentId,
        tutor: linkedTutorId,
        school_id: schoolId, 
        description,
        value: value, 
        dueDate: dueDate,
        status: 'pending',
        gateway: result.gateway,
        external_id: result.external_id,
        boleto_url: result.boleto_url,
        boleto_barcode: result.boleto_barcode,
        pix_code: result.pix_code,
        pix_qr_base64: result.pix_qr_base64,
        mp_payment_id: result.gateway === 'mercadopago' ? result.external_id : undefined,
        mp_pix_copia_e_cola: result.pix_code, // Garante que salvou aqui também
        mp_ticket_url: result.boleto_url
      });

      await newInvoice.save();

      // Notificação
      this.notifyInvoiceSmart(schoolId, payerName, payerPhone, student.fullName, newInvoice)
          .catch(err => console.error('⚠️ Falha ao enviar notificação WhatsApp (Background):', err.message));

      return await this.getInvoiceById(newInvoice._id, schoolId);

    } catch (error) {
      console.error('❌ ERRO Create Invoice (Raw):', error.message);
      
      // --- TRATAMENTO DE ERROS DO GATEWAY (CORA / AXIOS) ---
      // A Cora retorna o erro dentro de error.response.data.errors
      
      if (error.response && error.response.data && error.response.data.errors) {
          const coraErrors = error.response.data.errors;
          
          // Verifica se algum erro é sobre identidade/documento
          const isIdentityError = coraErrors.some(e => e.code === 'customer.document.identity' || (e.message && e.message.includes('CPF')));
          
          if (isIdentityError) {
              throw new Error('O CPF do Responsável Financeiro é inválido ou está incorreto. Verifique o cadastro do responsável.');
          }
          
          // Se for outro erro da Cora, tenta pegar a primeira mensagem legível
          if (coraErrors.length > 0 && coraErrors[0].message) {
               throw new Error(`Erro no Banco Cora: ${coraErrors[0].message}`);
          }
      }

      // Fallback para mensagens de texto simples
      if (error.message && (error.message.includes('customer.document.identity') || error.message.includes('not a valid CNPJ or CPF'))) {
         throw new Error('O CPF do Responsável Financeiro é inválido. Verifique o cadastro.');
      }
      
      if (error.message.includes('Erro Cora')) {
         // Tenta limpar o JSON sujo se vier como string
         throw new Error(`Erro na Cora: ${error.message.replace('Erro Cora Create:', '').trim()}`);
      }

      throw new Error(`Falha na criação da fatura: ${error.message}`);
    }
  }

  // --- REENVIO MANUAL ---
  async resendNotification(invoiceId, schoolId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, school_id: schoolId })
        .populate('student')
        .populate('tutor');

    if (!invoice) throw new Error('Fatura não encontrada.');

    let targetName, targetPhone;

    if (invoice.tutor) {
        targetName = invoice.tutor.fullName;
        targetPhone = invoice.tutor.phoneNumber || invoice.tutor.telefone || invoice.tutor.celular;
    } else if (invoice.student) {
        targetName = invoice.student.fullName;
        targetPhone = invoice.student.phoneNumber || invoice.student.telefone || invoice.student.celular;
    }

    if (!targetPhone) {
        throw new Error('Responsável financeiro não possui telefone cadastrado.');
    }

    try {
        await this.notifyInvoiceSmart(
            schoolId, 
            targetName, 
            targetPhone, 
            invoice.student.fullName, 
            invoice
        );
        return true;
    } catch (e) {
        console.error("Erro no reenvio manual:", e);
        throw new Error("Erro de comunicação com WhatsApp: " + e.message);
    }
  }

  // --- LÓGICA DE NOTIFICAÇÃO INTELIGENTE ---
  async notifyInvoiceSmart(schoolId, payerName, payerPhone, studentName, invoice) {
      
      // 1. Busca escola (Nome + Config Whatsapp)
      const school = await School.findById(schoolId).select('name whatsapp').lean();
      if (!school) throw new Error("Escola não encontrada.");

      const nomeEscola = school.name || "Sua Escola";

      // 1.1 Verificação de Conexão Híbrida
      let isReadyToSend = false;
      if (school.whatsapp && school.whatsapp.status === 'connected') {
          isReadyToSend = true; 
      } else {
          console.warn(`⚠️ [Zap] Banco diz desconectado. Verificando status real...`);
          const isReallyConnected = await whatsappService.ensureConnection(schoolId);
          if (isReallyConnected) isReadyToSend = true;
      }

      if (!isReadyToSend) {
          throw new Error("WhatsApp desconectado. Por favor, leia o QR Code novamente.");
      }

      if (!payerPhone) throw new Error("Telefone não informado.");

      // 2. Definição do Template por Data
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const vencimento = new Date(invoice.dueDate);
      vencimento.setHours(0, 0, 0, 0);

      const diffTime = vencimento.getTime() - hoje.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

      let listaTemplates;
      if (diffDays > 0) listaTemplates = TEMPLATES_FUTURO;
      else if (diffDays === 0) listaTemplates = TEMPLATES_HOJE;
      else listaTemplates = TEMPLATES_ATRASO;

      const templateEscolhido = listaTemplates[Math.floor(Math.random() * listaTemplates.length)];

      // 3. Formatação
      const valorFormatado = (invoice.value / 100).toFixed(2).replace('.', ',');
      const dataFormatada = new Date(invoice.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
      const primeiroNome = payerName.split(' ')[0];

      const msgTexto = templateEscolhido
          .replace('{escola}', nomeEscola) // [CORREÇÃO] Nome da Escola
          .replace('{nome}', primeiroNome)
          .replace('{descricao}', invoice.description)
          .replace('{valor}', valorFormatado)
          .replace('{vencimento}', dataFormatada);

      try {
          // Envia texto de introdução
          await whatsappService.sendText(schoolId, payerPhone, msgTexto);
          await new Promise(r => setTimeout(r, 1500)); // Delay um pouco maior para leitura

          // --- LÓGICA DE GATEWAY ---

          // A) CORA = BOLETO (PDF)
          if (invoice.gateway === 'cora' && invoice.boleto_url) {
              if (whatsappService.sendFile) {
                  try {
                      await whatsappService.sendFile(
                          schoolId, 
                          payerPhone, 
                          invoice.boleto_url, 
                          'Boleto_Escolar.pdf', 
                          `📄 Segue o boleto da ${nomeEscola}.`
                      );
                  } catch (e) {
                      // Fallback
                      await whatsappService.sendText(schoolId, payerPhone, `📄 Baixe o Boleto aqui: ${invoice.boleto_url}`);
                  }
              } else {
                  await whatsappService.sendText(schoolId, payerPhone, `📄 Baixe o Boleto aqui: ${invoice.boleto_url}`);
              }
              
              if (invoice.boleto_barcode) {
                   await new Promise(r => setTimeout(r, 800));
                   await whatsappService.sendText(schoolId, payerPhone, "Ou copie a linha digitável abaixo:");
                   await whatsappService.sendText(schoolId, payerPhone, invoice.boleto_barcode);
              }
          } 
          
          // B) MERCADO PAGO = PIX (COPIA E COLA)
          // [CORREÇÃO] Verifica ambos os campos onde o código pode estar salvo
          else if (invoice.gateway === 'mercadopago') {
              
              const pixCode = invoice.pix_code || invoice.mp_pix_copia_e_cola;

              if (pixCode) {
                  console.log(`💠 [Zap] Enviando Pix Copia e Cola para ${payerName}`);
                  await whatsappService.sendText(schoolId, payerPhone, "💠 Use o Pix Copia e Cola abaixo para pagar:");
                  // Pequeno delay para garantir que o código venha em mensagem separada (facilita copiar)
                  await new Promise(r => setTimeout(r, 500)); 
                  await whatsappService.sendText(schoolId, payerPhone, pixCode);
              } else if (invoice.boleto_url || invoice.mp_ticket_url) {
                  // Fallback raríssimo: MP gerou link/ticket em vez de Pix
                  const link = invoice.boleto_url || invoice.mp_ticket_url;
                  await whatsappService.sendText(schoolId, payerPhone, `📄 Link para pagamento: ${link}`);
              } else {
                  console.warn(`⚠️ [Zap] Fatura MP ${invoice._id} sem código Pix e sem Link.`);
              }
          }

      } catch (sendError) {
          console.error(`[Zap] Erro final de envio:`, sendError.message);
      }
  }

  async processDailyReminders() {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const amanha = new Date(hoje);
      amanha.setDate(amanha.getDate() + 1);

      const faturasVencendo = await Invoice.find({
          status: 'pending',
          dueDate: { $gte: hoje, $lt: amanha }
      }).populate('student').populate('tutor');

      console.log(`🔎 Cron: Encontradas ${faturasVencendo.length} faturas vencendo hoje.`);

      for (const fatura of faturasVencendo) {
          let targetName, targetPhone;
          if (fatura.tutor) {
              targetName = fatura.tutor.fullName;
              targetPhone = fatura.tutor.phoneNumber || fatura.tutor.telefone;
          } else if (fatura.student) {
              targetName = fatura.student.fullName;
              targetPhone = fatura.student.phoneNumber;
          }
          if (targetName && targetPhone) {
              await this.notifyInvoiceSmart(fatura.school_id, targetName, targetPhone, fatura.student.fullName, fatura)
                  .catch(e => console.error(`Erro ao notificar ${targetName}:`, e.message));
              await new Promise(r => setTimeout(r, 2000));
          }
      }
  }

  async cancelInvoice(invoiceId, schoolId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, school_id: schoolId });
    if (!invoice) throw new Error('Fatura não encontrada');
    if (invoice.status === 'paid') throw new Error('Fatura já PAGA não pode ser cancelada.');
    
    const school = await School.findById(schoolId).lean();
    const gatewayName = invoice.gateway === 'cora' ? 'CORA' : 'MERCADOPAGO';
    
    try {
        const gateway = GatewayFactory.create(school, gatewayName);
        if (invoice.external_id) {
            await gateway.cancelInvoice(invoice.external_id);
        }
    } catch (error) {
        console.warn(`Erro ao cancelar no gateway (${gatewayName}):`, error.message);
    }

    invoice.status = 'canceled';
    await invoice.save();
    return invoice;
  }

  async handlePaymentWebhook(externalId, providerName, statusRaw) {
    let invoice = await Invoice.findOne({ 
        $or: [ { external_id: externalId }, { mp_payment_id: externalId } ]
    });
    if (!invoice) return { processed: false, reason: 'not_found' };

    let novoStatus = invoice.status;
    const statusPago = ['approved', 'paid', 'COMPLETED', 'LIQUIDATED', 'PAID'];
    const statusCancelado = ['cancelled', 'rejected', 'CANCELED', 'canceled', 'CANCELLED'];

    if (statusRaw) {
        if (statusPago.includes(statusRaw) || statusPago.includes(statusRaw.toLowerCase())) {
            novoStatus = 'paid';
        } else if (statusCancelado.includes(statusRaw) || statusCancelado.includes(statusRaw.toLowerCase())) {
            novoStatus = 'canceled';
        }
    }

    if (invoice.status !== novoStatus) {
      invoice.status = novoStatus;
      if (novoStatus === 'paid' && !invoice.paidAt) invoice.paidAt = new Date();
      await invoice.save();
      console.log(`✅ [DB UPDATE] Fatura ${invoice._id} SALVA como ${novoStatus} (Origem: ${providerName})`);
    }
    return { processed: true, invoice };
  }

  async generateBatchPdf(invoiceIds, schoolId) {
    const invoices = await Invoice.find({
        _id: { $in: invoiceIds },
        school_id: schoolId,
        $or: [
            { boleto_url: { $exists: true, $ne: null } },
            { mp_ticket_url: { $exists: true, $ne: null } }
        ]
    });

    if (!invoices.length) {
        throw new Error("Nenhuma fatura com boleto/PDF encontrada para impressão.");
    }

    const mergedPdf = await PDFDocument.create();
    let processedCount = 0;

    for (const inv of invoices) {
        const url = inv.boleto_url || inv.mp_ticket_url;
        if (!url) continue;

        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const invoicePdf = await PDFDocument.load(response.data);
            const copiedPages = await mergedPdf.copyPages(invoicePdf, invoicePdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
            processedCount++;
        } catch (error) {
            console.error(`Erro ao baixar/processar boleto ${inv._id}:`, error.message);
        }
    }

    if (processedCount === 0) {
        throw new Error("Falha ao processar os arquivos PDF. Verifique se os links dos boletos estão acessíveis.");
    }

    return await mergedPdf.save();
  }

  async syncPendingInvoices(studentId, schoolId, singleInvoiceId = null) {
    const filter = {
        school_id: schoolId,
        status: 'pending',
        gateway: { $in: ['cora', 'mercadopago'] },
        external_id: { $exists: true }
    };
    if (studentId) filter.student = studentId;
    if (singleInvoiceId) filter._id = singleInvoiceId;

    const pendingInvoices = await Invoice.find(filter);
    if (pendingInvoices.length === 0) return;

    const school = await School.findById(schoolId).select('+mercadoPagoConfig.prodAccessToken').lean();
    if (!school) return;

    await Promise.all(pendingInvoices.map(async (invoice) => {
        try {
            if (invoice.gateway === 'mercadopago') {
                const mpToken = school.mercadoPagoConfig?.prodAccessToken;
                if (!mpToken) return;
                const res = await axios.get(`https://api.mercadopago.com/v1/payments/${invoice.external_id}`, { headers: { 'Authorization': `Bearer ${mpToken}` } });
                const statusMP = res.data.status;
                await this.handlePaymentWebhook(invoice.external_id, 'MP-SYNC', statusMP);
            }
        } catch (error) { /* Silent fail */ }
    }));
  }

  async getAllInvoices(filters = {}, schoolId) {
    try { await this.syncPendingInvoices(null, schoolId); } catch (e) {}
    const query = { school_id: schoolId }; 
    if (filters.status) query.status = filters.status;
    return Invoice.find(query).sort({ dueDate: -1 }).populate('student', 'fullName').populate('tutor', 'fullName');
  }

  async getInvoiceById(invoiceId, schoolId) {
    try { await this.syncPendingInvoices(null, schoolId, invoiceId); } catch (e) {}
    return Invoice.findOne({ _id: invoiceId, school_id: schoolId }).populate('student', 'fullName profilePicture').populate('tutor', 'fullName');
  }

  async getInvoicesByStudent(studentId, schoolId) {
    try { await this.syncPendingInvoices(studentId, schoolId); } catch (e) {}
    return Invoice.find({ student: studentId, school_id: schoolId }).sort({ dueDate: -1 }).populate('tutor', 'fullName');
  }
  
  async findOverdue(schoolId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Invoice.find({
      school_id: schoolId, 
      dueDate: { $lt: today },
      status: { $nin: ['paid', 'canceled'] }
    }).select('description value dueDate student').populate('student', 'fullName').lean();
  }
}

module.exports = new InvoiceService();