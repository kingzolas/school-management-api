const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ABSENCE_JUSTIFICATION_REQUEST_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'NEEDS_INFORMATION',
  'CANCELLED',
];

const ABSENCE_JUSTIFICATION_DOCUMENT_TYPES = [
  'MEDICAL_CERTIFICATE',
  'DECLARATION',
  'COURT_ORDER',
  'OTHER',
];

const AttachmentSchema = new Schema({
  fileName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, default: 0 },
  data: { type: Buffer, required: true },
}, { timestamps: true });

const AttendanceRefSchema = new Schema({
  attendanceId: {
    type: Schema.Types.ObjectId,
    ref: 'Attendance',
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
}, { _id: false });

const AbsenceJustificationRequestSchema = new Schema({
  schoolId: {
    type: Schema.Types.ObjectId,
    ref: 'School',
    required: true,
    index: true,
  },
  studentId: {
    type: Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    index: true,
  },
  guardianId: {
    type: Schema.Types.ObjectId,
    ref: 'Tutor',
    required: true,
    index: true,
  },
  guardianAccountId: {
    type: Schema.Types.ObjectId,
    ref: 'GuardianAccessAccount',
    default: null,
  },
  targetGuardianIds: {
    type: [{
      type: Schema.Types.ObjectId,
      ref: 'Tutor',
    }],
    default: [],
  },
  classId: {
    type: Schema.Types.ObjectId,
    ref: 'Class',
    required: true,
    index: true,
  },
  studentName: {
    type: String,
    required: true,
    trim: true,
  },
  className: {
    type: String,
    required: true,
    trim: true,
  },
  requestedStartDate: {
    type: Date,
    required: true,
    index: true,
  },
  requestedEndDate: {
    type: Date,
    required: true,
    index: true,
  },
  // Approved dates are local calendar days normalized to 00:00:00.000,
  // sorted ascending and deduplicated before persistence.
  approvedDates: {
    type: [Date],
    default: [],
  },
  documentType: {
    type: String,
    enum: ABSENCE_JUSTIFICATION_DOCUMENT_TYPES,
    default: 'OTHER',
  },
  notes: {
    type: String,
    default: '',
    trim: true,
  },
  attachments: {
    type: [AttachmentSchema],
    default: [],
  },
  status: {
    type: String,
    enum: ABSENCE_JUSTIFICATION_REQUEST_STATUSES,
    default: 'PENDING',
    index: true,
  },
  decisionReason: {
    type: String,
    default: '',
    trim: true,
  },
  reviewedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  reviewedAt: {
    type: Date,
    default: null,
  },
  appliedAt: {
    type: Date,
    default: null,
  },
  appliedJustificationId: {
    type: Schema.Types.ObjectId,
    ref: 'AbsenceJustification',
    default: null,
  },
  appliedDates: {
    type: [Date],
    default: [],
  },
  appliedAttendanceRefs: {
    type: [AttendanceRefSchema],
    default: [],
  },
}, { timestamps: true });

AbsenceJustificationRequestSchema.index({
  schoolId: 1,
  studentId: 1,
  classId: 1,
  status: 1,
  createdAt: -1,
});

AbsenceJustificationRequestSchema.index({
  schoolId: 1,
  studentId: 1,
  classId: 1,
  requestedStartDate: 1,
  requestedEndDate: 1,
});

AbsenceJustificationRequestSchema.index({
  schoolId: 1,
  targetGuardianIds: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  'AbsenceJustificationRequest',
  AbsenceJustificationRequestSchema
);

module.exports.ABSENCE_JUSTIFICATION_REQUEST_STATUSES =
  ABSENCE_JUSTIFICATION_REQUEST_STATUSES;
module.exports.ABSENCE_JUSTIFICATION_DOCUMENT_TYPES =
  ABSENCE_JUSTIFICATION_DOCUMENT_TYPES;
