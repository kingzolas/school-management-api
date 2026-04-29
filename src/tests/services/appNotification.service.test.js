const test = require('node:test');
const assert = require('node:assert/strict');

const AppNotification = require('../../api/models/appNotification.model');
const AppNotificationService = require('../../api/services/appNotification.service');

test('app notification staff roles are persisted and queried with compatible normalization', async (t) => {
  const inserted = [];
  t.mock.method(AppNotification, 'insertMany', async (documents) => {
    inserted.push(...documents);
    return documents;
  });

  await AppNotificationService.createFromRealtimeEvent(
    'official_document_request_created',
    {
      schoolId: '507f1f77bcf86cd799439011',
      requestId: '507f1f77bcf86cd799439012',
      action: 'created_by_guardian',
      targetRoles: ['Admin', 'Gestor'],
      request: {
        _id: '507f1f77bcf86cd799439012',
        documentType: 'attendance_declaration',
        studentName: 'Ana Silva',
      },
    }
  );

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].audience, 'staff');
  assert.deepEqual(inserted[0].targetRoles, ['admin', 'gestor']);

  const query = AppNotificationService.buildViewerQuery({
    viewerType: 'staff',
    viewerId: '507f1f77bcf86cd799439013',
    schoolId: '507f1f77bcf86cd799439011',
    roles: ['Gestor'],
  });
  const roleClause = query.$or.find((clause) => clause.targetRoles?.$in);

  assert.ok(roleClause.targetRoles.$in.includes('gestor'));
  assert.ok(roleClause.targetRoles.$in.includes('Gestor'));

  const fallbackQuery = AppNotificationService.buildViewerQuery({
    viewerType: 'staff',
    viewerId: '507f1f77bcf86cd799439013',
    schoolId: '507f1f77bcf86cd799439011',
    roles: [],
  });
  const fallbackRoleClause = fallbackQuery.$or.find((clause) => clause.targetRoles?.$in);

  assert.ok(fallbackRoleClause.targetRoles.$in.includes('gestor'));
  assert.ok(fallbackRoleClause.targetRoles.$in.includes('Secretaria'));
});

test('registration request event creates staff notification with review action', async (t) => {
  const inserted = [];
  t.mock.method(AppNotification, 'insertMany', async (documents) => {
    inserted.push(...documents);
    return documents;
  });

  await AppNotificationService.createFromRealtimeEvent('registration:created', {
    _id: '507f1f77bcf86cd799439014',
    school_id: '507f1f77bcf86cd799439011',
    studentData: {
      fullName: 'Lia Santos',
      intendedGrade: '3º Ano',
    },
    tutorData: {
      fullName: 'Marina Santos',
    },
    selectedClassSnapshot: {
      name: '3º Ano B',
    },
  });

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].audience, 'staff');
  assert.equal(inserted[0].entity, 'registration_request');
  assert.equal(inserted[0].entityId, '507f1f77bcf86cd799439014');
  assert.equal(
    inserted[0].metadata.action,
    'open_registration_request_review'
  );
  assert.match(inserted[0].summary, /Lia Santos/);
  assert.match(inserted[0].summary, /3º Ano B/);
});
