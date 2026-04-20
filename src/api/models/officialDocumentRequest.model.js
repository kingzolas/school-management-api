const mongoose = require('mongoose');

const { Schema } = mongoose;

const {
  OFFICIAL_DOCUMENT_REQUESTER_TYPES,
  OFFICIAL_DOCUMENT_REQUEST_STATUSES,
} = require('../validators/officialDocument.validator');
const {
  actorContextSchema,
  requestAuditEventSchema,
} = require('./officialDocumentShared.schema');

const officialDocumentRequestSchema = new Schema({
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
  requesterType: {
    type: String,
    enum: OFFICIAL_DOCUMENT_REQUESTER_TYPES,
    required: true,
    index: true,
  },
  requesterId: {
    type: Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  targetGuardianIds: {
    type: [{
      type: Schema.Types.ObjectId,
      ref: 'Tutor',
    }],
    default: [],
  },
  documentType: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  purpose: {
    type: String,
    default: null,
    trim: true,
  },
  reason: {
    type: String,
    default: null,
    trim: true,
  },
  notes: {
    type: String,
    default: null,
    trim: true,
  },
  status: {
    type: String,
    enum: OFFICIAL_DOCUMENT_REQUEST_STATUSES,
    default: 'requested',
    index: true,
  },
  approvedBy: {
    type: actorContextSchema,
    default: null,
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  rejectedBy: {
    type: actorContextSchema,
    default: null,
  },
  rejectedAt: {
    type: Date,
    default: null,
  },
  rejectionReason: {
    type: String,
    default: null,
    trim: true,
  },
  cancelledBy: {
    type: actorContextSchema,
    default: null,
  },
  cancelledAt: {
    type: Date,
    default: null,
  },
  cancellationReason: {
    type: String,
    default: null,
    trim: true,
  },
  createdBy: {
    type: actorContextSchema,
    required: true,
  },
  updatedBy: {
    type: actorContextSchema,
    required: true,
  },
  lastStatusChangedAt: {
    type: Date,
    default: Date.now,
  },
  auditTrail: {
    type: [requestAuditEventSchema],
    default: [],
  },
}, {
  timestamps: true,
});

officialDocumentRequestSchema.index({ schoolId: 1, studentId: 1, status: 1, createdAt: -1 });
officialDocumentRequestSchema.index({ schoolId: 1, requesterType: 1, requesterId: 1, createdAt: -1 });
officialDocumentRequestSchema.index({ schoolId: 1, documentType: 1, createdAt: -1 });
officialDocumentRequestSchema.index({ schoolId: 1, targetGuardianIds: 1, createdAt: -1 });

module.exports = mongoose.model('OfficialDocumentRequest', officialDocumentRequestSchema);
