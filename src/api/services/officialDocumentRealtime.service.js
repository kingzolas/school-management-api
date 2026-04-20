const OFFICIAL_DOCUMENT_REALTIME_EVENTS = {
  requestCreated: 'official_document_request_created',
  requestUpdated: 'official_document_request_updated',
  requestApproved: 'official_document_request_approved',
  requestRejected: 'official_document_request_rejected',
  requestCancelled: 'official_document_request_cancelled',
  preparing: 'official_document_preparing',
  awaitingSignature: 'official_document_awaiting_signature',
  signed: 'official_document_signed',
  published: 'official_document_published',
  downloaded: 'official_document_downloaded',
  replaced: 'official_document_replaced',
  cancelled: 'official_document_cancelled',
};

const toPlainRecord = (record) => {
  if (!record) return null;
  if (typeof record.toJSON === 'function') return record.toJSON();
  if (typeof record.toObject === 'function') return record.toObject();
  return record;
};

const extractId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

const extractIdList = (values) => (
  Array.isArray(values) ? values.map(extractId).filter(Boolean) : []
);

const buildRequestPayload = (request, extra = {}) => {
  const snapshot = toPlainRecord(request);
  if (!snapshot) return null;

  return {
    entity: 'official_document_request',
    schoolId: extractId(snapshot.schoolId),
    studentId: extractId(snapshot.studentId),
    requestId: extractId(snapshot._id),
    documentType: snapshot.documentType || null,
    status: snapshot.status || null,
    requesterType: snapshot.requesterType || null,
    requesterId: extractId(snapshot.requesterId),
    targetGuardianIds: extractIdList(snapshot.targetGuardianIds),
    lastStatusChangedAt: snapshot.lastStatusChangedAt || snapshot.updatedAt || null,
    request: snapshot,
    ...extra,
  };
};

const buildDocumentPayload = (document, extra = {}) => {
  const snapshot = toPlainRecord(document);
  if (!snapshot) return null;

  delete snapshot.fileData;

  return {
    entity: 'official_document',
    schoolId: extractId(snapshot.schoolId),
    studentId: extractId(snapshot.studentId),
    requestId: extractId(snapshot.requestId),
    documentId: extractId(snapshot._id),
    documentType: snapshot.documentType || null,
    status: snapshot.status || null,
    version: snapshot.version || null,
    guardianIds: extractIdList(snapshot.guardianIds),
    isVisibleToGuardian: snapshot.isVisibleToGuardian === true,
    isVisibleToStudent: snapshot.isVisibleToStudent === true,
    lastStatusChangedAt: snapshot.lastStatusChangedAt || snapshot.updatedAt || null,
    document: snapshot,
    ...extra,
  };
};

const emitOfficialDocumentEvent = (eventEmitter, eventName, payload) => {
  if (!eventEmitter || !eventName || !payload?.schoolId) return;

  eventEmitter.emit(eventName, {
    ...payload,
    eventName,
    emittedAt: new Date(),
  });
};

const emitRequestEvent = (eventEmitter, eventName, request, extra = {}) => {
  const payload = buildRequestPayload(request, extra);
  emitOfficialDocumentEvent(eventEmitter, eventName, payload);
};

const emitDocumentEvent = (eventEmitter, eventName, document, extra = {}) => {
  const payload = buildDocumentPayload(document, extra);
  emitOfficialDocumentEvent(eventEmitter, eventName, payload);
};

module.exports = {
  OFFICIAL_DOCUMENT_REALTIME_EVENTS,
  buildRequestPayload,
  buildDocumentPayload,
  emitOfficialDocumentEvent,
  emitRequestEvent,
  emitDocumentEvent,
};
