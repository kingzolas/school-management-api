const WhatsappSession = require('../models/whatsapp-session.model');
const Tutor = require('../models/tutor.model');
const Student = require('../models/student.model');

const whatsappService = require('./whatsapp.service');
const tempAccessTokenService = require('./tempAccessToken.service');

class WhatsappBotService {
  constructor() {
    this.sessionTtlMinutes = 20;

    this.globalCommands = {
      cancel: ['cancelar', 'sair', 'parar'],
      back: ['voltar'],
      menu: ['menu'],
      restart: ['reiniciar', 'recomecar', 'recomeçar'],
      help: ['ajuda'],
      handoff: ['atendimento', 'humano', 'secretaria'],
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
      'pix',
      'oi',
      'ola',
      'olá',
      'bom dia',
      'boa tarde',
      'boa noite',
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

  buildMenuMessage() {
    return [
      'Olá! Posso te ajudar com o acesso ao portal do aluno.',
      '',
      'Responda com:',
      '1 - Acessar portal do aluno',
      '2 - Falar com a escola',
      '',
      'Você também pode usar: menu, voltar, cancelar, ajuda ou atendimento.',
    ].join('\n');
  }

  buildHelpMessage() {
    return [
      'Posso te ajudar com o acesso ao portal do aluno.',
      '',
      'Comandos disponíveis:',
      'menu - ver opções principais',
      'voltar - retornar uma etapa',
      'cancelar - encerrar atendimento',
      'reiniciar - começar de novo',
      'atendimento - falar com a escola',
    ].join('\n');
  }

  buildCpfPrompt() {
    return [
      'Informe o CPF do responsável cadastrado na escola.',
      'Pode enviar apenas os 11 números, com ou sem pontuação.',
    ].join('\n');
  }

  buildSelectionMessage(options) {
    const lines = ['Encontrei mais de um aluno vinculado a este CPF:'];

    options.forEach((option, index) => {
      lines.push(`${index + 1} - ${option.fullName}`);
    });

    lines.push('');
    lines.push('Responda apenas com o número do aluno que deseja acessar.');
    lines.push('Se quiser, digite voltar para informar outro CPF.');

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
        expires_at: new Date(now.getTime() + this.sessionTtlMinutes * 60 * 1000),
        last_interaction_at: now,
      });
    }

    return session;
  }

  async touchSession(session) {
    session.last_interaction_at = new Date();
    session.expires_at = new Date(Date.now() + this.sessionTtlMinutes * 60 * 1000);
    await session.save();
  }

  async sendAndPersist({ schoolId, phone, message, session = null }) {
    await whatsappService.sendText(schoolId, phone, message);

    if (session) {
      session.last_bot_message = message;
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
    session.attempt_count = 0;
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

  async resolveStudentsByCpf({ schoolId, cpf }) {
    const tutors = await Tutor.find({
      school_id: schoolId,
      cpf,
    }).select('_id fullName cpf phoneNumber telefone celular');

    if (!tutors.length) {
      return [];
    }

    const tutorIds = tutors.map((tutor) => tutor._id);

    const students = await Student.find({
      school_id: schoolId,
      isActive: true,
      $or: [
        { financialTutorId: { $in: tutorIds } },
        { 'tutors.tutorId': { $in: tutorIds } },
      ],
    }).select('_id fullName enrollmentNumber financialTutorId tutors');

    const dedup = new Map();

    for (const student of students) {
      const financialTutorId = student.financialTutorId
        ? String(student.financialTutorId)
        : null;

      let matchedTutorId = financialTutorId;

      if (!matchedTutorId && Array.isArray(student.tutors)) {
        const related = student.tutors.find((item) =>
          tutorIds.some((id) => String(id) === String(item.tutorId))
        );
        matchedTutorId = related ? String(related.tutorId) : null;
      }

      dedup.set(String(student._id), {
        student_id: student._id,
        tutor_id: matchedTutorId,
        fullName: student.fullName,
        enrollmentNumber: student.enrollmentNumber || null,
      });
    }

    return Array.from(dedup.values()).sort((a, b) =>
      a.fullName.localeCompare(b.fullName, 'pt-BR')
    );
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
        message: 'Certo. Encaminhe sua solicitação para a secretaria da escola.',
      });
    }

    return this.sendAndPersist({
      schoolId,
      phone,
      message: this.buildMenuMessage(),
      session,
    });
  }

  async handleCpfStep({ session, schoolId, phone, rawText }) {
    const cpf = this.extractCpf(rawText);

    if (!cpf || !this.isValidCpf(cpf)) {
      session.invalid_cpf_attempts += 1;
      await this.touchSession(session);

      if (session.invalid_cpf_attempts >= 3) {
        return this.sendAndPersist({
          schoolId,
          phone,
          message:
            'Não foi possível validar o CPF. Digite reiniciar para tentar novamente ou atendimento para falar com a escola.',
          session,
        });
      }

      return this.sendAndPersist({
        schoolId,
        phone,
        message:
          'Não consegui identificar um CPF válido. Envie apenas os 11 números do CPF do responsável.',
        session,
      });
    }

    const options = await this.resolveStudentsByCpf({ schoolId, cpf });

    session.cpf = cpf;
    session.invalid_cpf_attempts = 0;

    if (!options.length) {
      await this.touchSession(session);

      return this.sendAndPersist({
        schoolId,
        phone,
        message:
          'Não encontramos um responsável com esse CPF nesta escola. Verifique os números e tente novamente.',
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

      if (session.invalid_selection_attempts >= 3) {
        return this.sendAndPersist({
          schoolId,
          phone,
          message:
            'Estou com dificuldade para identificar o aluno desejado. Digite voltar para informar outro CPF ou atendimento para falar com a escola.',
          session,
        });
      }

      return this.sendAndPersist({
        schoolId,
        phone,
        message: `Não entendi qual aluno você deseja acessar. Responda apenas com um número de 1 a ${options.length}.`,
        session,
      });
    }

    const selected = options[choice - 1];

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

    if (!portalBaseUrl) {
      session.status = 'cancelled';
      await session.save();

      return this.sendAndPersist({
        schoolId,
        phone,
        message:
          'O portal do aluno não está configurado no momento. Entre em contato com a escola.',
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

    return this.sendAndPersist({
      schoolId,
      phone,
      message: [
        `Pronto! O acesso ao portal do aluno ${selected.fullName} foi liberado.`,
        accessLink,
        '',
        'Este link expira em 20 minutos.',
      ].join('\n'),
    });
  }

  async handleIncomingMessage({ schoolId, phone, messageText }) {
    const rawText = String(messageText || '').trim();
    const normalized = this.normalizeText(rawText);

    if (!normalized) return;

    const session = await this.getOrCreateSession({ schoolId, phone });
    session.last_user_message = rawText;
    session.attempt_count += 1;
    await this.touchSession(session);

    if (this.isGlobalCommand(normalized, 'cancel')) {
      await this.cancelSession(session);

      return this.sendAndPersist({
        schoolId,
        phone,
        message: 'Atendimento encerrado. Quando quiser, envie uma nova mensagem.',
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
        message: 'Certo. Encaminhe sua solicitação para a secretaria da escola.',
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
      return this.handleCpfStep({
        session,
        schoolId,
        phone,
        rawText,
      });
    }

    if (session.current_step === 'awaiting_student_selection') {
      return this.handleStudentSelectionStep({
        session,
        schoolId,
        phone,
        normalized,
      });
    }

    return this.handleMainOption({
      session,
      schoolId,
      phone,
      normalized,
    });
  }
}

module.exports = new WhatsappBotService();