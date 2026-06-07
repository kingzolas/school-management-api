const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const ActivityPrintRun = require('../../api/models/activityPrintRun.model');

test('ActivityPrintRun validates pending runs with opaque QR payload items', async () => {
  const doc = new ActivityPrintRun({
    activityPageId: new mongoose.Types.ObjectId(),
    bookId: new mongoose.Types.ObjectId(),
    schoolId: new mongoose.Types.ObjectId(),
    classId: new mongoose.Types.ObjectId(),
    teacherId: new mongoose.Types.ObjectId(),
    requestedByUserId: new mongoose.Types.ObjectId(),
    printDate: new Date('2026-06-04T12:00:00.000Z'),
    studentIds: [new mongoose.Types.ObjectId()],
    generatedPdfKey: '',
    status: 'pending',
    snapshot: {
      schoolName: 'Escola Teste',
      schoolLogoContentType: 'image/png',
      className: '3 B',
      teacherName: 'Professora Teste',
      subject: 'Portugues',
      bookTitle: 'Caderno',
      activityTitle: 'Pagina 3',
      pageNumber: 3,
    },
    items: [
      {
        studentId: new mongoose.Types.ObjectId(),
        studentName: 'Aluno Teste',
        qrCodePayload: 'AH-ACTIVITY-1:123e4567-e89b-12d3-a456-426614174000',
        pageNumber: 1,
        status: 'pending',
      },
    ],
  });

  await assert.doesNotReject(() => doc.validate());
  assert.equal(doc.items[0].qrCodePayload.startsWith('AH-ACTIVITY-1:'), true);
});
