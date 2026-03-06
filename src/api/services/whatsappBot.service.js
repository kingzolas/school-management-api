const mongoose = require('mongoose');
const WhatsappSession = require('../models/whatsapp-session.model');
const Tutor = require('../models/tutor.model');
const Student = require('../models/student.model');
const School = require('../models/school.model');

const whatsappService = require('./whatsapp.service');
const tempAccessTokenService = require('./tempAccessToken.service');

class WhatsappBotService {
  constructor() {
    this.sessionTtlMinutes = 20;

    this.recentMessages = new Map();

    this.globalCommands = {
      cancel: ['cancelar', 'sair', 'parar', 'encerrar'],
      back: ['voltar', 'anterior'],
      menu: ['menu', 'inicio', 'início'],
      restart: ['reiniciar', 'recomecar', 'recomeçar'],
      help: ['ajuda', 'opcoes', 'opções'],
      handoff: ['atendimento', 'humano', 'secretaria', 'atendente', 'escola'],
    };

    this.entryKeywords = [
      'boleto',
      'mensalidade',
      'segunda via',
      '2 via',
      '2a via',
      'pagamento',
      'pagar',
      'financeiro',
      'fatura',
      'pix'
    ];
  }

  normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  extractDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  maskCpf(value) {
    const digits = this.extractDigits(value);
    if (digits.length !== 11) return null;
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  isValidCpf(cpf) {
    const digits = this.extractDigits(cpf);

    if (digits.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(digits)) return false;

    let sum = 0;
    for (let i = 0; i < 9; i += 1) {
      sum += Number(digits[i]) * (10 - i);
    }

    let rest = (sum * 10) % 11;
    if (rest === 10) rest = 0;
    if (rest !== Number(digits[9])) return false;

    sum = 0;
    for (let i = 0; i < 10; i += 1) {
      sum += Number(digits[i]) * (11 - i);
    }

    rest = (sum * 10) % 11;
    if (rest === 10) rest = 0;

    return rest === Number(digits[10]);
  }

  extractCpf(value) {
    const digits = this.extractDigits(value);
    if (digits.length === 11) return digits;

    const match = String(value || '').match(/(\d{3}\.?\d{3}\.?\d{3}\-?\d{2})/);
    if (!match) return null;

    const cpf = this.extractDigits(match[1]);
    return cpf.length === 11 ? cpf : null;
  }

  isGlobalCommand(normalized, commandName) {
    return this.globalCommands[commandName].includes(normalized);
  }

  getGreeting() {
    const utc = new Date().getTime() + (new Date().getTimezoneOffset() * 60000);
    const brazilTime = new Date(utc + (3600000 * -3));
    const hour = brazilTime.getHours();

    if (hour >= 5 && hour < 12) return 'Bom dia';
    if (hour >= 12 && hour < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  buildMenuMessage() {
    return [
      '*Como posso te ajudar hoje?*',
      'Responda com o número da opção desejada:',
      '',
      '1️⃣ - Acessar Portal do Aluno (Boletos e Mensalidades)',
      '2️⃣ - Falar com a Escola (Atendimento Humano)',
      '',
      '💡 _Dica: Digite *cancelar* a qualquer momento para encerrar este atendimento._'
    ].join('\n');
  }

  buildHelpMessage() {
    return [
      '🤖 *Menu de Ajuda - Academy Hub*',
      '',
      'Você pode digitar as seguintes palavras a qualquer momento:',
      '🔸 *menu* - Para ver as opções principais',
      '🔸 *voltar* - Para retornar à etapa anterior',
      '🔸 *cancelar* - Para encerrar o nosso atendimento',
      '🔸 *atendimento* - Para ser transferido para a secretaria da escola'
    ].join('\n');
  }

  buildCpfPrompt() {
    return [
      '🔎 *Acesso ao Portal do Aluno*',
      '',
      'Por favor, informe o *CPF do responsável* financeiro cadastrado na escola.',
      '_Você pode digitar apenas os 11 números, com ou sem pontuação._',
      '',
      '↩️ _Digite *voltar* para ver o menu principal ou *cancelar* para sair._'
    ].join('\n');
  }

  buildSelectionMessage(options) {
    const lines = ['Encontrei os seguintes alunos vinculados a este CPF:', ''];

    options.forEach((option, index) => {
      const relationship = option.relationship ? ` (${option.relationship})` : '';
      lines.push(`*${index + 1}* - ${option.fullName}${relationship}`);
    });

    lines.push('');
    lines.push('👉 *Responda apenas com o número* correspondente ao aluno que deseja acessar.');
    lines.push('');
    lines.push('↩️ _Digite *voltar* para informar outro CPF ou *cancelar* para sair._');

    return lines.join('\n');
  }

  buildAccessLink(baseUrl, rawToken) {
    const safeBase = String(baseUrl || '').replace(/\/$/, '');
    return `${safeBase}/auth/student/access-by-token?token=${encodeURIComponent(rawToken)}`;
  }

  async getOrCreateSession({ schoolId, phone }) {
    const now = new Date();

    let session = await WhatsappSession.findOne({
      school_id: schoolId,
      phone,
      status: 'active',
    }).sort({ createdAt: -1 });

    if (session && session.expires_at.getTime() < now.getTime()) {
      session.status = 'expired';
      await session.save();
      session = null;
    }

    if (!session) {
      session = await WhatsappSession.create({
        school_id: schoolId,
        phone,
        status: 'active',
        current_step: 'awaiting_main_option',
        previous_step: null,
        attempt_count: 0,
        expires_at: new Date(now.getTime() + this.sessionTtlMinutes * 60 * 1000),
        last_interaction_at: now,
      });
    } else if (typeof session.attempt_count !== 'number') {
      session.attempt_count = 0;
    }

    return session;
  }

  async touchSession(session) {
    session.last_interaction_at = new Date();
    session.expires_at = new Date(Date.now() + this.sessionTtlMinutes * 60 * 1000);
    await session.save();
  }

  async sendAndPersist({ schoolId, phone, message, session = null }) {
    let finalMessage = message;

    if (session && session.attempt_count === 1) {
      const greeting = this.getGreeting();
      const presentation = `${greeting}! 🤖 Sou o assistente virtual do software *Academy Hub*.\n\n`;
      finalMessage = presentation + finalMessage;
    }

    await whatsappService.sendText(schoolId, phone, finalMessage);

    if (session) {
      session.last_bot_message = finalMessage;
      await this.touchSession(session);
    }
  }

  async resetSession(session) {
    session.current_step = 'awaiting_main_option';
    session.previous_step = null;
    session.cpf = null;
    session.selected_student_id = null;
    session.selected_tutor_id = null;
    session.student_options = [];
    session.invalid_cpf_attempts = 0;
    session.invalid_selection_attempts = 0;
    await this.touchSession(session);
  }

  async cancelSession(session) {
    session.status = 'cancelled';
    session.current_step = 'completed';
    session.previous_step = null;
    session.student_options = [];
    session.cpf = null;
    await session.save();
  }

  async expireOldSessions() {
    return WhatsappSession.updateMany(
      {
        status: 'active',
        expires_at: { $lt: new Date() },
      },
      {
        $set: { status: 'expired' },
      }
    );
  }

  async _logSchoolContext({ schoolId, instanceName = null }) {
    try {
      const school = await School.findById(schoolId).select('_id name whatsapp');

      if (!school) {
        console.warn(
          `⚠️ [BotLookup] Escola não encontrada por schoolId=${schoolId} | instanceName=${instanceName || 'N/A'}`
        );
        return null;
      }

      console.log(
        `🏫 [BotLookup] Contexto da escola | schoolId=${school._id} | nome=${school.name || 'Sem nome'} | db.instanceName=${school.whatsapp?.instanceName || 'N/A'} | req.instanceName=${instanceName || 'N/A'} | zap.status=${school.whatsapp?.status || 'N/A'}`
      );

      return school;
    } catch (error) {
      console.error(
        `❌ [BotLookup] Erro ao carregar contexto da escola | schoolId=${schoolId}: ${error.message}`
      );
      return null;
    }
  }

  async resolveStudentsByCpf({ schoolId, cpf, instanceName = null }) {
    const cpfDigits = this.extractDigits(cpf);
    const cpfMasked = this.maskCpf(cpfDigits);

    const cpfCandidates = [...new Set([cpf, cpfDigits, cpfMasked].filter(Boolean))];

    console.log('='.repeat(90));
    console.log(`🔎 [BotLookup] Iniciando busca por CPF do tutor`);
    console.log(`📌 [BotLookup] schoolId=${schoolId}`);
    console.log(`📌 [BotLookup] instanceName=${instanceName || 'N/A'}`);
    console.log(`📌 [BotLookup] cpf.original=${cpf}`);
    console.log(`📌 [BotLookup] cpf.digits=${cpfDigits}`);
    console.log(`📌 [BotLookup] cpf.masked=${cpfMasked || 'N/A'}`);
    console.log(`📌 [BotLookup] cpf.candidates=${JSON.stringify(cpfCandidates)}`);

    await this._logSchoolContext({ schoolId, instanceName });

    const tutorFilter = {
      school_id: new mongoose.Types.ObjectId(String(schoolId)),
      cpf: { $in: cpfCandidates },
    };

    console.log(`🧪 [BotLookup] Query Tutor: ${JSON.stringify(tutorFilter, null, 2)}`);

    const tutors = await Tutor.find(tutorFilter)
      .select('_id fullName cpf phoneNumber email school_id students')
      .lean();

    console.log(`👥 [BotLookup] Tutors encontrados=${tutors.length}`);

    tutors.forEach((tutor, index) => {
      console.log(
        `👤 [BotLookup] Tutor[${index}] id=${tutor._id} | nome=${tutor.fullName} | cpf=${tutor.cpf} | school_id=${tutor.school_id} | linkedStudents=${Array.isArray(tutor.students) ? tutor.students.length : 0}`
      );
    });

    if (!tutors.length) {
      console.warn(
        `⚠️ [BotLookup] Nenhum tutor encontrado para o CPF informado na escola ${schoolId}`
      );
      console.log('='.repeat(90));
      return [];
    }

    const tutorIds = tutors.map((tutor) => tutor._id);

    const studentFilter = {
      school_id: new mongoose.Types.ObjectId(String(schoolId)),
      isActive: true,
      $or: [
        { financialTutorId: { $in: tutorIds } },
        { 'tutors.tutorId': { $in: tutorIds } },
      ],
    };

    console.log(`🧪 [BotLookup] Query Student: ${JSON.stringify(studentFilter, null, 2)}`);

    const students = await Student.find(studentFilter)
      .select('_id fullName enrollmentNumber financialTutorId financialResp tutors school_id isActive')
      .populate({
        path: 'financialTutorId',
        select: '_id fullName cpf phoneNumber email school_id',
      })
      .populate({
        path: 'tutors.tutorId',
        select: '_id fullName cpf phoneNumber email school_id',
      })
      .lean();

    console.log(`🎓 [BotLookup] Students encontrados=${students.length}`);

    students.forEach((student, index) => {
      console.log(
        `🧒 [BotLookup] Student[${index}] id=${student._id} | nome=${student.fullName} | school_id=${student.school_id} | active=${student.isActive} | financialResp=${student.financialResp}`
      );

      if (student.financialTutorId) {
        console.log(
          `   💰 financialTutorId=${student.financialTutorId._id || student.financialTutorId} | nome=${student.financialTutorId.fullName || 'N/A'} | cpf=${student.financialTutorId.cpf || 'N/A'}`
        );
      } else {
        console.log(`   💰 financialTutorId=N/A`);
      }

      if (Array.isArray(student.tutors) && student.tutors.length) {
        student.tutors.forEach((link, linkIndex) => {
          console.log(
            `   🔗 tutors[${linkIndex}] relationship=${link.relationship || 'N/A'} | tutorId=${link.tutorId?._id || link.tutorId || 'N/A'} | tutorNome=${link.tutorId?.fullName || 'N/A'} | tutorCpf=${link.tutorId?.cpf || 'N/A'}`
          );
        });
      } else {
        console.log(`   🔗 sem vínculos em tutors[]`);
      }
    });

    const dedup = new Map();

    for (const student of students) {
      let matchedTutorId = null;
      let matchedRelationship = null;

      if (
        student.financialTutorId &&
        tutorIds.some((id) => String(id) === String(student.financialTutorId._id || student.financialTutorId))
      ) {
        matchedTutorId = String(student.financialTutorId._id || student.financialTutorId);
        matchedRelationship = 'Responsável Financeiro';
      }

      if (!matchedTutorId && Array.isArray(student.tutors)) {
        const related = student.tutors.find((item) =>
          tutorIds.some((id) => String(id) === String(item.tutorId?._id || item.tutorId))
        );

        if (related) {
          matchedTutorId = String(related.tutorId?._id || related.tutorId);
          matchedRelationship = related.relationship || null;
        }
      }

      dedup.set(String(student._id), {
        student_id: student._id,
        tutor_id: matchedTutorId,
        fullName: student.fullName,
        enrollmentNumber: student.enrollmentNumber || null,
        relationship: matchedRelationship,
      });
    }

    const options = Array.from(dedup.values()).sort((a, b) =>
      a.fullName.localeCompare(b.fullName, 'pt-BR')
    );

    console.log(`✅ [BotLookup] Opções finais deduplicadas=${options.length}`);
    options.forEach((option, index) => {
      console.log(
        `📄 [BotLookup] Option[${index}] student_id=${option.student_id} | tutor_id=${option.tutor_id || 'N/A'} | nome=${option.fullName} | rel=${option.relationship || 'N/A'}`
      );
    });
    console.log('='.repeat(90));

    return options;
  }

  async handleMainOption({ session, schoolId, phone, normalized }) {
    const matchedEntryKeyword = this.entryKeywords.some((keyword) =>
      normalized.includes(this.normalizeText(keyword))
    );

    if (normalized === '1' || matchedEntryKeyword) {
      session.previous_step = session.current_step;
      session.current_step = 'awaiting_cpf';
      await this.touchSession(session);

      return this.sendAndPersist({
        schoolId,
        phone,
        message: this.buildCpfPrompt(),
        session,
      });
    }

    if (normalized === '2') {
      session.status = 'handoff_requested';
      session.current_step = 'completed';
      await session.save();

      return this.sendAndPersist({
        schoolId,
        phone,
        message: 'Certo! Vou transferir você para a equipe da escola.\n\nPor favor, aguarde um momento e já envie a sua solicitação.',
        session,
      });
    }

    return this.sendAndPersist({
      schoolId,
      phone,
      message: this.buildMenuMessage(),
      session,
    });
  }

  async handleCpfStep({ session, schoolId, phone, rawText, instanceName = null }) {
    const cpf = this.extractCpf(rawText);

    console.log(
      `🧾 [BotCPF] Recebendo CPF | schoolId=${schoolId} | phone=${phone} | instanceName=${instanceName || 'N/A'} | raw="${rawText}" | extracted=${cpf || 'N/A'}`
    );

    if (!cpf || !this.isValidCpf(cpf)) {
      session.invalid_cpf_attempts += 1;
      await this.touchSession(session);

      console.warn(
        `⚠️ [BotCPF] CPF inválido | schoolId=${schoolId} | phone=${phone} | tentativa=${session.invalid_cpf_attempts}`
      );

      if (session.invalid_cpf_attempts >= 3) {
        return this.sendAndPersist({
          schoolId,
          phone,
          message:
            'Ainda não consegui validar o CPF.\n\nVocê pode digitar *reiniciar* para tentar de novo desde o começo, ou *atendimento* para falar diretamente com a escola.',
          session,
        });
      }

      return this.sendAndPersist({
        schoolId,
        phone,
        message:
          'Não consegui identificar um CPF válido na sua mensagem. Por favor, envie apenas os 11 números do CPF do responsável.',
        session,
      });
    }

    const options = await this.resolveStudentsByCpf({ schoolId, cpf, instanceName });

    session.cpf = cpf;
    session.invalid_cpf_attempts = 0;

    if (!options.length) {
      await this.touchSession(session);

      return this.sendAndPersist({
        schoolId,
        phone,
        message:
          'Poxa, não encontrei nenhum aluno vinculado a este CPF nesta escola.\n\nVerifique se os números estão corretos e envie novamente. Se precisar, digite *cancelar*.',
        session,
      });
    }

    if (options.length === 1) {
      const selected = options[0];

      session.selected_student_id = selected.student_id;
      session.selected_tutor_id = selected.tutor_id || null;
      session.student_options = options;
      session.previous_step = session.current_step;
      session.current_step = 'completed';
      await this.touchSession(session);

      return this.generateAndSendAccess({
        schoolId,
        phone,
        session,
        selected,
      });
    }

    session.student_options = options;
    session.previous_step = session.current_step;
    session.current_step = 'awaiting_student_selection';
    await this.touchSession(session);

    return this.sendAndPersist({
      schoolId,
      phone,
      message: this.buildSelectionMessage(options),
      session,
    });
  }

  async handleStudentSelectionStep({ session, schoolId, phone, normalized }) {
    const choice = Number(normalized);
    const options = Array.isArray(session.student_options) ? session.student_options : [];

    if (!Number.isInteger(choice) || choice < 1 || choice > options.length) {
      session.invalid_selection_attempts += 1;
      await this.touchSession(session);

      console.warn(
        `⚠️ [BotSelect] Seleção inválida | schoolId=${schoolId} | phone=${phone} | input=${normalized} | totalOptions=${options.length} | tentativa=${session.invalid_selection_attempts}`
      );

      if (session.invalid_selection_attempts >= 3) {
        return this.sendAndPersist({
          schoolId,
          phone,
          message:
            'Ainda não consegui identificar a sua escolha.\n\nDigite *voltar* para informar outro CPF ou *atendimento* para falar com a secretaria.',
          session,
        });
      }

      return this.sendAndPersist({
        schoolId,
        phone,
        message: `Por favor, responda apenas com um número de *1* a *${options.length}* correspondente ao aluno na lista.`,
        session,
      });
    }

    const selected = options[choice - 1];

    console.log(
      `✅ [BotSelect] Aluno selecionado | schoolId=${schoolId} | phone=${phone} | choice=${choice} | studentId=${selected.student_id} | tutorId=${selected.tutor_id || 'N/A'} | nome=${selected.fullName}`
    );

    session.selected_student_id = selected.student_id;
    session.selected_tutor_id = selected.tutor_id || null;
    session.invalid_selection_attempts = 0;
    session.previous_step = session.current_step;
    session.current_step = 'completed';
    await this.touchSession(session);

    return this.generateAndSendAccess({
      schoolId,
      phone,
      session,
      selected,
    });
  }

  async generateAndSendAccess({ schoolId, phone, session, selected }) {
    const portalBaseUrl = process.env.STUDENT_PORTAL_BASE_URL;

    console.log(
      `🔐 [BotAccess] Gerando acesso | schoolId=${schoolId} | phone=${phone} | studentId=${selected.student_id} | tutorId=${selected.tutor_id || 'N/A'} | studentName=${selected.fullName}`
    );

    if (!portalBaseUrl) {
      session.status = 'cancelled';
      await session.save();

      console.error(`❌ [BotAccess] STUDENT_PORTAL_BASE_URL não configurada.`);

      return this.sendAndPersist({
        schoolId,
        phone,
        message:
          '⚠️ O acesso automático ao portal não está configurado no momento.\n\nVou transferir você para a secretaria da escola para te auxiliarem com isso.',
      });
    }

    const { rawToken } = await tempAccessTokenService.createStudentPortalToken({
      schoolId,
      tutorId: selected.tutor_id || null,
      studentId: selected.student_id,
      requestedPhone: phone,
    });

    const accessLink = this.buildAccessLink(portalBaseUrl, rawToken);

    session.status = 'completed';
    await session.save();

    console.log(
      `✅ [BotAccess] Link gerado com sucesso | schoolId=${schoolId} | studentId=${selected.student_id}`
    );

    return this.sendAndPersist({
      schoolId,
      phone,
      message: [
        `Tudo pronto! 🎉 O acesso para o aluno *${selected.fullName}* foi gerado.`,
        '',
        'Acesse pelo link abaixo:',
        accessLink,
        '',
        '⏱️ _Este link é seguro e expira automaticamente em 20 minutos._'
      ].join('\n'),
    });
  }

  async handleIncomingMessage({ schoolId, phone, messageText, instanceName = null }) {
    const rawText = String(messageText || '').trim();
    const normalized = this.normalizeText(rawText);

    if (!normalized) return;

    const dedupKey = `${schoolId}:${phone}:${normalized}`;
    const now = Date.now();
    const lastSeen = this.recentMessages.get(dedupKey);

    if (lastSeen && (now - lastSeen) < 1500) {
      console.log(`♻️ [Anti-Duplicação] Mensagem ignorada: ${normalized}`);
      return;
    }

    this.recentMessages.set(dedupKey, now);
    if (this.recentMessages.size > 200) this.recentMessages.clear();

    const session = await this.getOrCreateSession({ schoolId, phone });
    session.last_user_message = rawText;
    session.attempt_count += 1;
    await this.touchSession(session);

    console.log(
      `🧠 [Bot] Nova mensagem | schoolId=${schoolId} | phone=${phone} | instanceName=${instanceName || 'N/A'} | currentStep=${session.current_step} | text="${rawText}"`
    );

    if (this.isGlobalCommand(normalized, 'cancel')) {
      await this.cancelSession(session);
      return this.sendAndPersist({
        schoolId,
        phone,
        message: 'Atendimento encerrado. O Academy Hub agradece o seu contato! 👋\n\nQuando precisar de algo, é só mandar um "Oi".',
      });
    }

    if (this.isGlobalCommand(normalized, 'restart')) {
      await this.resetSession(session);
      return this.sendAndPersist({
        schoolId,
        phone,
        message: this.buildMenuMessage(),
        session,
      });
    }

    if (this.isGlobalCommand(normalized, 'menu')) {
      session.previous_step = session.current_step;
      session.current_step = 'awaiting_main_option';
      await this.touchSession(session);
      return this.sendAndPersist({
        schoolId,
        phone,
        message: this.buildMenuMessage(),
        session,
      });
    }

    if (this.isGlobalCommand(normalized, 'help')) {
      return this.sendAndPersist({
        schoolId,
        phone,
        message: this.buildHelpMessage(),
        session,
      });
    }

    if (this.isGlobalCommand(normalized, 'handoff')) {
      session.status = 'handoff_requested';
      session.current_step = 'completed';
      await session.save();
      return this.sendAndPersist({
        schoolId,
        phone,
        message: 'Certo! Vou transferir você para a equipe da escola.\n\nPor favor, aguarde um momento e já envie a sua solicitação.',
        session,
      });
    }

    if (this.isGlobalCommand(normalized, 'back')) {
      if (session.current_step === 'awaiting_student_selection') {
        session.current_step = 'awaiting_cpf';
        session.previous_step = 'awaiting_student_selection';
        session.student_options = [];
        session.selected_student_id = null;
        session.selected_tutor_id = null;
        await this.touchSession(session);

        return this.sendAndPersist({
          schoolId,
          phone,
          message: this.buildCpfPrompt(),
          session,
        });
      }

      session.current_step = 'awaiting_main_option';
      session.previous_step = null;
      await this.touchSession(session);

      return this.sendAndPersist({
        schoolId,
        phone,
        message: this.buildMenuMessage(),
        session,
      });
    }

    if (session.current_step === 'awaiting_cpf') {
      return this.handleCpfStep({ session, schoolId, phone, rawText, instanceName });
    }

    if (session.current_step === 'awaiting_student_selection') {
      return this.handleStudentSelectionStep({ session, schoolId, phone, normalized });
    }

    return this.handleMainOption({ session, schoolId, phone, normalized });
  }
}

module.exports = new WhatsappBotService();