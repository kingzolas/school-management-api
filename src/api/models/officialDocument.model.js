const mongoose = require('mongoose');

const { Schema } = mongoose;

const {
  OFFICIAL_DOCUMENT_STATUSES,
  OFFICIAL_DOCUMENT_SIGNATURE_PROVIDERS,
  OFFICIAL_DOCUMENT_STORAGE_PROVIDERS,
} = require('../validators/officialDocument.validator');
const {
  documentAuditEventSchema,
} = require('./officialDocumentShared.schema');

const officialDocumentSchema = new Schema({
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
  guardianIds: {
    type: [{
      type: Schema.Types.ObjectId,
      ref: 'Tutor',
    }],
    default: [],
  },
  requestId: {
    type: Schema.Types.ObjectId,
    ref: 'OfficialDocumentRequest',
    default: null,
    index: true,
  },
  documentType: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  status: {
    type: String,
    enum: OFFICIAL_DOCUMENT_STATUSES,
    default: 'signed',
    index: true,
  },
  version: {
    type: Number,
    min: 1,
    default: 1,
  },
  generatedByUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  signedByUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  publishedByUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  generatedAt: {
    type: Date,
    default: null,
  },
  signedAt: {
    type: Date,
    default: null,
  },
  publishedAt: {
    type: Date,
    default: null,
  },
  downloadedAt: {
    type: Date,
    default: null,
  },
  isVisibleToGuardian: {
    type: Boolean,
    default: false,
    index: true,
  },
  isVisibleToStudent: {
    type: Boolean,
    default: false,
    index: true,
  },
  fileName: {
    type: String,
    required: true,
    trim: true,
  },
  mimeType: {
    type: String,
    required: true,
    trim: true,
    default: 'application/pdf',
  },
  fileSize: {
    type: Number,
    required: true,
    min: 0,
  },
  fileHash: {
    type: String,
    required: true,
    trim: true,
  },
  storageProvider: {
    type: String,
    enum: OFFICIAL_DOCUMENT_STORAGE_PROVIDERS,
    default: 'mongodb_buffer',
  },
  storageKey: {
    type: String,
    default: null,
    trim: true,
  },
  fileData: {
    type: Buffer,
    select: false,
  },
  certificateSubject: {
    type: String,
    default: null,
    trim: true,
  },
  certificateSerialNumber: {
    type: String,
    default: null,
    trim: true,
  },
  signatureProvider: {
    type: String,
    enum: OFFICIAL_DOCUMENT_SIGNATURE_PROVIDERS,
    default: 'local_windows_certificate',
  },
  notes: {
    type: String,
    default: null,
    trim: true,
  },
  supersedesDocumentId: {
    type: Schema.Types.ObjectId,
    ref: 'OfficialDocument',
    default: null,
  },
  replacedByDocumentId: {
    type: Schema.Types.ObjectId,
    ref: 'OfficialDocument',
    default: null,
  },
  lastStatusChangedAt: {
    type: Date,
    default: Date.now,
  },
  auditTrail: {
    type: [documentAuditEventSchema],
    default: [],
  },
}, {
  timestamps: true,
});

officialDocumentSchema.index({ schoolId: 1, studentId: 1, status: 1, publishedAt: -1, createdAt: -1 });
officialDocumentSchema.index({ schoolId: 1, requestId: 1, createdAt: -1 });
officialDocumentSchema.index({ schoolId: 1, guardianIds: 1, status: 1, publishedAt: -1 });
officialDocumentSchema.index({ schoolId: 1, documentType: 1, createdAt: -1 });

officialDocumentSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.fileData;
    ret.hasFile = Boolean(ret.fileName && ret.fileSize);
    return ret;
  },
});

module.exports = mongoose.model('OfficialDocument', officialDocumentSchema);
