const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const JustificationDocumentSchema = new Schema({
  fileName: { type: String, default: null },
  mimeType: { type: String, default: null },
  size: { type: Number, default: 0 },
  data: { type: Buffer, default: null }
}, { _id: false });

const AttendanceRefSchema = new Schema({
  attendanceId: {
    type: Schema.Types.ObjectId,
    ref: 'Attendance',
    required: true
  },
  date: {
    type: Date,
    required: true
  }
}, { _id: false });

const AbsenceJustificationSchema = new Schema({
  schoolId: {
    type: Schema.Types.ObjectId,
    ref: 'School',
    required: true,
    index: true
  },
  classId: {
    type: Schema.Types.ObjectId,
    ref: 'Class',
    required: true,
    index: true
  },
  studentId: {
    type: Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    index: true
  },
  requestId: {
    type: Schema.Types.ObjectId,
    ref: 'AbsenceJustificationRequest',
    default: null,
    index: true
  },
  documentType: {
    type: String,
    enum: ['MEDICAL_CERTIFICATE', 'DECLARATION', 'COURT_ORDER', 'OTHER'],
    default: 'OTHER'
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'],
    default: 'PENDING',
    index: true
  },
  coverageStartDate: {
    type: Date,
    required: true
  },
  coverageEndDate: {
    type: Date,
    required: true
  },
  absenceDates: {
    type: [Date],
    default: []
  },
  attendanceRefs: {
    type: [AttendanceRefSchema],
    default: []
  },
  document: {
    type: JustificationDocumentSchema,
    default: () => ({})
  },
  rulesSnapshot: {
    deadlineDays: { type: Number, default: 3 },
    deadlineType: { type: String, enum: ['CALENDAR_DAYS'], default: 'CALENDAR_DAYS' },
    submittedWithinDeadline: { type: Boolean, default: true },
    lateOverrideUsed: { type: Boolean, default: false }
  },
  submission: {
    submittedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submittedAt: { type: Date, default: Date.now }
  },
  review: {
    reviewedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '' }
  }
}, { timestamps: true });

AbsenceJustificationSchema.index({ schoolId: 1, classId: 1, studentId: 1, status: 1 });
AbsenceJustificationSchema.index({ schoolId: 1, classId: 1, coverageStartDate: 1, coverageEndDate: 1 });

module.exports = mongoose.model('AbsenceJustification', AbsenceJustificationSchema);
