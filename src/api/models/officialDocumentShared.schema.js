const mongoose = require('mongoose');

const { Schema } = mongoose;

const {
  OFFICIAL_DOCUMENT_ACTOR_TYPES,
  OFFICIAL_DOCUMENT_REQUEST_STATUSES,
  OFFICIAL_DOCUMENT_STATUSES,
} = require('../validators/officialDocument.validator');

const actorContextSchema = new Schema({
  actorType: {
    type: String,
    enum: OFFICIAL_DOCUMENT_ACTOR_TYPES,
    required: true,
  },
  actorId: {
    type: Schema.Types.ObjectId,
    default: null,
  },
}, { _id: false });

const requestAuditEventSchema = new Schema({
  eventType: {
    type: String,
    required: true,
    trim: true,
  },
  occurredAt: {
    type: Date,
    default: Date.now,
  },
  actorType: {
    type: String,
    enum: OFFICIAL_DOCUMENT_ACTOR_TYPES,
    required: true,
  },
  actorId: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  fromStatus: {
    type: String,
    enum: [...OFFICIAL_DOCUMENT_REQUEST_STATUSES, null],
    default: null,
  },
  toStatus: {
    type: String,
    enum: [...OFFICIAL_DOCUMENT_REQUEST_STATUSES, null],
    default: null,
  },
  note: {
    type: String,
    default: null,
    trim: true,
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: null,
  },
}, { _id: false });

const documentAuditEventSchema = new Schema({
  eventType: {
    type: String,
    required: true,
    trim: true,
  },
  occurredAt: {
    type: Date,
    default: Date.now,
  },
  actorType: {
    type: String,
    enum: OFFICIAL_DOCUMENT_ACTOR_TYPES,
    required: true,
  },
  actorId: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  fromStatus: {
    type: String,
    enum: [...OFFICIAL_DOCUMENT_STATUSES, null],
    default: null,
  },
  toStatus: {
    type: String,
    enum: [...OFFICIAL_DOCUMENT_STATUSES, null],
    default: null,
  },
  note: {
    type: String,
    default: null,
    trim: true,
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: null,
  },
}, { _id: false });

module.exports = {
  actorContextSchema,
  requestAuditEventSchema,
  documentAuditEventSchema,
};
