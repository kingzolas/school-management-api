const test = require('node:test');
const assert = require('node:assert/strict');

const { NotificationRecipientResolverService } = require('../../api/services/notificationRecipientResolver.service');

function createFindByIdModel(records = {}) {
  return {
    findById(id) {
      return {
        select() {
          return {
            async lean() {
              return records[String(id)] || null;
            },
          };
        },
      };
    },
  };
}

test('recipient resolver prefers invoice tutor when available', async () => {
  const service = new NotificationRecipientResolverService({
    StudentModel: createFindByIdModel(),
    TutorModel: createFindByIdModel(),
  });

  const result = await service.resolveByInvoice({
    student: {
      _id: 'student-1',
      fullName: 'Aluno Teste',
      financialResp: 'TUTOR',
    },
    tutor: {
      _id: 'tutor-1',
      fullName: 'Maria Responsavel',
      phoneNumber: '(91) 99999-1111',
      email: 'maria@example.com',
    },
  });

  assert.equal(result.recipient_role, 'tutor');
  assert.equal(result.recipient_name, 'Maria Responsavel');
  assert.equal(result.target_email, 'maria@example.com');
  assert.equal(result.available_channels.whatsapp, true);
  assert.equal(result.available_channels.email, true);
});

test('recipient resolver uses student when student is financial responsible', async () => {
  const service = new NotificationRecipientResolverService({
    StudentModel: createFindByIdModel(),
    TutorModel: createFindByIdModel(),
  });

  const result = await service.resolveByInvoice({
    student: {
      _id: 'student-2',
      fullName: 'Aluno Financeiro',
      phoneNumber: '(91) 98888-2222',
      email: 'aluno@example.com',
      financialResp: 'STUDENT',
    },
    tutor: null,
  });

  assert.equal(result.recipient_role, 'student');
  assert.equal(result.recipient_name, 'Aluno Financeiro');
  assert.equal(result.target_email, 'aluno@example.com');
  assert.equal(result.resolution_reason, 'student_financial_responsible');
});

test('recipient resolver handles missing email without breaking channels', async () => {
  const service = new NotificationRecipientResolverService({
    StudentModel: createFindByIdModel(),
    TutorModel: createFindByIdModel(),
  });

  const result = await service.resolveByInvoice({
    student: {
      _id: 'student-3',
      fullName: 'Aluno Sem Email',
      phoneNumber: '(91) 97777-3333',
      financialResp: 'STUDENT',
    },
  });

  assert.equal(result.recipient_role, 'student');
  assert.equal(result.target_email, null);
  assert.equal(result.available_channels.whatsapp, true);
  assert.equal(result.available_channels.email, false);
  assert.equal(result.email_issue_code, 'RECIPIENT_EMAIL_MISSING');
});

test('recipient resolver handles missing email and phone', async () => {
  const service = new NotificationRecipientResolverService({
    StudentModel: createFindByIdModel(),
    TutorModel: createFindByIdModel(),
  });

  const result = await service.resolveByInvoice({
    student: {
      _id: 'student-4',
      fullName: 'Aluno Sem Contato',
      financialResp: 'STUDENT',
    },
  });

  assert.equal(result.recipient_role, 'student');
  assert.equal(result.available_channels.whatsapp, false);
  assert.equal(result.available_channels.email, false);
  assert.equal(result.email_issue_code, 'RECIPIENT_EMAIL_MISSING');
});

test('recipient resolver flags invalid e-mail without exposing it as available channel', async () => {
  const service = new NotificationRecipientResolverService({
    StudentModel: createFindByIdModel(),
    TutorModel: createFindByIdModel(),
  });

  const result = await service.resolveByInvoice({
    student: {
      _id: 'student-6',
      fullName: 'Aluno Email Invalido',
      email: 'email-invalido',
      phoneNumber: '(91) 97777-9999',
      financialResp: 'STUDENT',
    },
  });

  assert.equal(result.target_email, 'email-invalido');
  assert.equal(result.target_email_normalized, null);
  assert.equal(result.available_channels.email, false);
  assert.equal(result.email_issue_code, 'RECIPIENT_EMAIL_INVALID');
  assert.equal(result.channel_issues.email, 'RECIPIENT_EMAIL_INVALID');
});

test('recipient resolver falls back to unknown when tutor is required but unresolved', async () => {
  const service = new NotificationRecipientResolverService({
    StudentModel: createFindByIdModel(),
    TutorModel: createFindByIdModel(),
  });

  const result = await service.resolveByInvoice({
    student: {
      _id: 'student-5',
      fullName: 'Aluno Dependente',
      financialResp: 'TUTOR',
      financialTutorId: 'tutor-missing',
      tutors: [],
    },
    tutor: null,
  });

  assert.equal(result.recipient_role, 'unknown');
  assert.equal(result.resolution_reason, 'financial_tutor_unresolved');
  assert.equal(result.available_channels.whatsapp, false);
  assert.equal(result.available_channels.email, false);
});
