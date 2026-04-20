const OfficialDocumentRequest = require('../models/officialDocumentRequest.model');
const OfficialDocument = require('../models/officialDocument.model');
const Student = require('../models/student.model');
const GuardianAccessLink = require('../models/guardianAccessLink.model');
const appEmitter = require('../../loaders/eventEmitter');
const {
  OFFICIAL_DOCUMENT_REALTIME_EVENTS,
  emitRequestEvent,
} = require('./officialDocumentRealtime.service');
const {
  OFFICIAL_DOCUMENT_REQUEST_STATUSES,
  OFFICIAL_DOCUMENT_REQUEST_TRANSITIONS,
  assertEnumValue,
  assertTransition,
  buildActorContext,
  buildAuditEvent,
  calculateAgeAt,
  createHttpError,
  hasOwn,
  normalizeOfficialDocumentType,
  normalizeObjectIdList,
  normalizeString,
} = require('../validators/officialDocument.validator');

const requestPopulation = [
  { path: 'studentId', select: 'fullName enrollmentNumber birthDate cpf' },
  { path: 'targetGuardianIds', select: 'fullName cpf phoneNumber email' },
];

class OfficialDocumentRequestService {
  constructor(options = {}) {
    this.OfficialDocumentRequestModel =
      options.OfficialDocumentRequestModel || OfficialDocumentRequest;
    this.OfficialDocumentModel =
      options.OfficialDocumentModel || OfficialDocument;
    this.StudentModel = options.StudentModel || Student;
    this.GuardianAccessLinkModel =
      options.GuardianAccessLinkModel || GuardianAccessLink;
    this.eventEmitter = options.eventEmitter || appEmitter;
    this.now = options.now || (() => new Date());
  }

  _getNow() {
    return this.now();
  }

  _extractId(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value._id) return String(value._id);
    return String(value);
  }

  _applyPopulation(query, population = requestPopulation) {
    if (query && typeof query.populate === 'function') {
      return query.populate(population);
    }
    return query;
  }

  _applySort(query, sort) {
    if (query && typeof query.sort === 'function') {
      return query.sort(sort);
    }
    return query;
  }

  _applySelect(query, selection) {
    if (query && typeof query.select === 'function') {
      return query.select(selection);
    }
    return query;
  }

  _normalizeActor(actor = {}) {
    return {
      actorType: actor.actorType || 'system',
      actorId: actor.actorId || null,
    };
  }

  _appendAuditEvent(record, payload) {
    if (!Array.isArray(record.auditTrail)) {
      record.auditTrail = [];
    }

    record.auditTrail.push(buildAuditEvent(payload));
  }

  _emitRequestEvent(eventName, request, extra = {}) {
    emitRequestEvent(this.eventEmitter, eventName, request, extra);
  }

  _emitRequestStatusEvents(request, options = {}) {
    const fromStatus = options.fromStatus || null;
    const toStatus = request?.status || options.toStatus || null;
    const basePayload = {
      fromStatus,
      toStatus,
      action: options.action || null,
      metadata: options.metadata || null,
    };

    this._emitRequestEvent(
      OFFICIAL_DOCUMENT_REALTIME_EVENTS.requestUpdated,
      request,
      basePayload
    );

    const statusEventMap = {
      approved: OFFICIAL_DOCUMENT_REALTIME_EVENTS.requestApproved,
      rejected: OFFICIAL_DOCUMENT_REALTIME_EVENTS.requestRejected,
      cancelled: OFFICIAL_DOCUMENT_REALTIME_EVENTS.requestCancelled,
      awaiting_signature: OFFICIAL_DOCUMENT_REALTIME_EVENTS.awaitingSignature,
      signed: OFFICIAL_DOCUMENT_REALTIME_EVENTS.signed,
      published: OFFICIAL_DOCUMENT_REALTIME_EVENTS.published,
      downloaded: OFFICIAL_DOCUMENT_REALTIME_EVENTS.downloaded,
    };

    if (statusEventMap[toStatus]) {
      this._emitRequestEvent(statusEventMap[toStatus], request, basePayload);
    }

    if (toStatus === 'under_review' || toStatus === 'approved') {
      this._emitRequestEvent(
        OFFICIAL_DOCUMENT_REALTIME_EVENTS.preparing,
        request,
        basePayload
      );
    }
  }

  async _loadStudent(studentId, schoolId) {
    const query = this.StudentModel.findOne({
      _id: studentId,
      school_id: schoolId,
    });
    const student = await this._applySelect(
      query,
      '_id fullName birthDate tutors financialTutorId school_id'
    );

    if (!student) {
      throw createHttpError('Aluno nao encontrado para esta escola.', 404, {
        code: 'student_not_found',
      });
    }

    return student;
  }

  _collectStudentGuardianIds(student = {}) {
    const tutorIds = [];

    if (student.financialTutorId) {
      tutorIds.push(this._extractId(student.financialTutorId));
    }

    if (Array.isArray(student.tutors)) {
      student.tutors.forEach((entry) => {
        const tutorId = this._extractId(entry?.tutorId);
        if (tutorId) tutorIds.push(tutorId);
      });
    }

    return [...new Set(tutorIds.filter(Boolean))];
  }

  async _assertGuardianAccess({ schoolId, accountId, tutorId, studentId }) {
    const linkQuery = this.GuardianAccessLinkModel.findOne({
      school_id: schoolId,
      guardianAccessAccountId: accountId,
      tutorId,
      studentId,
      status: 'active',
    });
    const link = await this._applySelect(linkQuery, '_id');

    if (!link) {
      throw createHttpError(
        'O responsavel autenticado nao possui acesso ativo para este aluno.',
        403,
        { code: 'guardian_access_denied' }
      );
    }
  }

  _resolveTargetGuardianIds(student, requesterType, requesterId, explicitGuardianIds) {
    const studentGuardianIds = this._collectStudentGuardianIds(student);
    const normalizedExplicitIds = normalizeObjectIdList(explicitGuardianIds);

    if (normalizedExplicitIds.length > 0) {
      const invalidGuardianId = normalizedExplicitIds.find(
        (guardianId) => !studentGuardianIds.includes(guardianId)
      );

      if (invalidGuardianId) {
        throw createHttpError(
          'Existe responsavel informado que nao pertence ao aluno selecionado.',
          400,
          { code: 'guardian_not_linked_to_student', guardianId: invalidGuardianId }
        );
      }

      return normalizedExplicitIds;
    }

    if (requesterType === 'guardian' && requesterId) {
      return [String(requesterId)];
    }

    if (requesterType === 'school') {
      return studentGuardianIds;
    }

    return [];
  }

  async _ensureStudentCanOpenOwnRequest(student, actorStudentId) {
    const studentId = this._extractId(student?._id || student);
    if (String(studentId) !== String(actorStudentId || '')) {
      throw createHttpError('O aluno autenticado so pode operar as proprias solicitacoes.', 403, {
        code: 'student_scope_denied',
      });
    }

    const age = calculateAgeAt(student.birthDate, this._getNow());
    if (age === null || age < 18) {
      throw createHttpError(
        'Somente alunos maiores de idade podem abrir solicitacoes diretamente.',
        403,
        { code: 'student_underage_request_forbidden' }
      );
    }
  }

  async _ensureNoIssuedDocuments(requestId, schoolId) {
    if (!requestId || !this.OfficialDocumentModel?.exists) {
      return;
    }

    const existingDocument = await this.OfficialDocumentModel.exists({
      requestId,
      schoolId,
      status: { $in: ['signed', 'published'] },
    });

    if (existingDocument) {
      throw createHttpError(
        'Esta solicitacao ja possui documento assinado ou publicado vinculado.',
        409,
        { code: 'request_has_issued_document' }
      );
    }
  }

  async _getRequestDocument(id, schoolId, { populate = false } = {}) {
    let query = this.OfficialDocumentRequestModel.findOne({
      _id: id,
      schoolId,
    });

    if (populate) {
      query = this._applyPopulation(query);
    }

    const request = await query;

    if (!request) {
      throw createHttpError('Solicitacao de documento nao encontrada.', 404, {
        code: 'official_document_request_not_found',
      });
    }

    return request;
  }

  async _saveAndReload(request, schoolId) {
    await request.save();
    return this.getSchoolRequestById(request._id, schoolId);
  }

  _setStatus(request, nextStatus, actor, options = {}) {
    const normalizedActor = this._normalizeActor(actor);
    const previousStatus = request.status;
    const shouldOverride = options.overrideTransition === true;

    if (!shouldOverride) {
      assertTransition(
        OFFICIAL_DOCUMENT_REQUEST_TRANSITIONS,
        previousStatus,
        nextStatus,
        'status da solicitacao'
      );
    }

    if (previousStatus !== nextStatus) {
      request.status = nextStatus;
      request.lastStatusChangedAt = this._getNow();
    }

    request.updatedBy = buildActorContext(normalizedActor.actorType, normalizedActor.actorId);
    this._appendAuditEvent(request, {
      eventType: options.eventType || 'request_status_updated',
      actorType: normalizedActor.actorType,
      actorId: normalizedActor.actorId,
      fromStatus: previousStatus,
      toStatus: nextStatus,
      note: options.note || null,
      metadata: options.metadata || null,
      occurredAt: this._getNow(),
    });
  }

  async createSchoolRequest(payload = {}, context = {}) {
    const schoolId = context.schoolId;
    const actorId = context.actorId;

    if (!schoolId || !actorId) {
      throw createHttpError('Contexto da escola nao informado para criar a solicitacao.', 403, {
        code: 'school_context_required',
      });
    }

    const student = await this._loadStudent(payload.studentId, schoolId);
    const targetGuardianIds = this._resolveTargetGuardianIds(
      student,
      'school',
      actorId,
      payload.targetGuardianIds
    );
    const documentType = normalizeOfficialDocumentType(payload.documentType);

    if (!documentType) {
      throw createHttpError('documentType e obrigatorio.', 400, {
        code: 'document_type_required',
      });
    }

    const now = this._getNow();
    const actor = buildActorContext('school', actorId);
    const request = new this.OfficialDocumentRequestModel({
      schoolId,
      studentId: student._id || payload.studentId,
      requesterType: 'school',
      requesterId: actorId,
      targetGuardianIds,
      documentType,
      purpose: normalizeString(payload.purpose),
      reason: normalizeString(payload.reason),
      notes: normalizeString(payload.notes),
      status: 'requested',
      createdBy: actor,
      updatedBy: actor,
      lastStatusChangedAt: now,
      auditTrail: [
        buildAuditEvent({
          eventType: 'request_created',
          actorType: 'school',
          actorId,
          toStatus: 'requested',
          metadata: {
            requesterType: 'school',
            targetGuardianIds,
          },
          occurredAt: now,
        }),
      ],
    });

    await request.save();
    const result = await this.getSchoolRequestById(request._id, schoolId);
    this._emitRequestEvent(OFFICIAL_DOCUMENT_REALTIME_EVENTS.requestCreated, result, {
      toStatus: result.status,
      action: 'created_by_school',
    });
    return result;
  }

  async createGuardianRequest(payload = {}, context = {}) {
    const schoolId = context.schoolId;
    const actorId = context.tutorId;
    const accountId = context.accountId;

    if (!schoolId || !actorId || !accountId) {
      throw createHttpError('Contexto do responsavel nao informado.', 403, {
        code: 'guardian_context_required',
      });
    }

    const student = await this._loadStudent(payload.studentId, schoolId);
    await this._assertGuardianAccess({
      schoolId,
      accountId,
      tutorId: actorId,
      studentId: this._extractId(student._id),
    });

    const documentType = normalizeOfficialDocumentType(payload.documentType);
    if (!documentType) {
      throw createHttpError('documentType e obrigatorio.', 400, {
        code: 'document_type_required',
      });
    }

    const targetGuardianIds = this._resolveTargetGuardianIds(
      student,
      'guardian',
      actorId,
      payload.targetGuardianIds
    );
    const now = this._getNow();
    const actor = buildActorContext('guardian', actorId);
    const request = new this.OfficialDocumentRequestModel({
      schoolId,
      studentId: student._id || payload.studentId,
      requesterType: 'guardian',
      requesterId: actorId,
      targetGuardianIds,
      documentType,
      purpose: normalizeString(payload.purpose),
      reason: normalizeString(payload.reason),
      notes: normalizeString(payload.notes),
      status: 'requested',
      createdBy: actor,
      updatedBy: actor,
      lastStatusChangedAt: now,
      auditTrail: [
        buildAuditEvent({
          eventType: 'request_created',
          actorType: 'guardian',
          actorId,
          toStatus: 'requested',
          metadata: {
            requesterType: 'guardian',
            targetGuardianIds,
          },
          occurredAt: now,
        }),
      ],
    });

    await request.save();
    const result = await this.getGuardianRequestById(request._id, context);
    this._emitRequestEvent(OFFICIAL_DOCUMENT_REALTIME_EVENTS.requestCreated, result, {
      toStatus: result.status,
      action: 'created_by_guardian',
    });
    return result;
  }

  async createStudentRequest(payload = {}, context = {}) {
    const schoolId = context.schoolId;
    const actorId = context.studentId;

    if (!schoolId || !actorId) {
      throw createHttpError('Contexto do aluno nao informado.', 403, {
        code: 'student_context_required',
      });
    }

    const student = await this._loadStudent(payload.studentId, schoolId);
    await this._ensureStudentCanOpenOwnRequest(student, actorId);

    const documentType = normalizeOfficialDocumentType(payload.documentType);
    if (!documentType) {
      throw createHttpError('documentType e obrigatorio.', 400, {
        code: 'document_type_required',
      });
    }

    const targetGuardianIds = this._resolveTargetGuardianIds(
      student,
      'student',
      actorId,
      payload.targetGuardianIds
    );
    const now = this._getNow();
    const actor = buildActorContext('student', actorId);
    const request = new this.OfficialDocumentRequestModel({
      schoolId,
      studentId: student._id || payload.studentId,
      requesterType: 'student',
      requesterId: actorId,
      targetGuardianIds,
      documentType,
      purpose: normalizeString(payload.purpose),
      reason: normalizeString(payload.reason),
      notes: normalizeString(payload.notes),
      status: 'requested',
      createdBy: actor,
      updatedBy: actor,
      lastStatusChangedAt: now,
      auditTrail: [
        buildAuditEvent({
          eventType: 'request_created',
          actorType: 'student',
          actorId,
          toStatus: 'requested',
          metadata: {
            requesterType: 'student',
            targetGuardianIds,
          },
          occurredAt: now,
        }),
      ],
    });

    await request.save();
    const result = await this.getStudentRequestById(request._id, context);
    this._emitRequestEvent(OFFICIAL_DOCUMENT_REALTIME_EVENTS.requestCreated, result, {
      toStatus: result.status,
      action: 'created_by_student',
    });
    return result;
  }

  async listSchoolRequests(filters = {}, schoolId) {
    const query = { schoolId };

    if (normalizeString(filters.studentId)) query.studentId = normalizeString(filters.studentId);
    if (normalizeString(filters.requesterType)) query.requesterType = normalizeString(filters.requesterType);
    if (normalizeString(filters.documentType)) query.documentType = normalizeOfficialDocumentType(filters.documentType);
    if (normalizeString(filters.status)) query.status = normalizeString(filters.status);
    if (normalizeString(filters.targetGuardianId)) {
      query.targetGuardianIds = normalizeString(filters.targetGuardianId);
    }

    let requestQuery = this.OfficialDocumentRequestModel.find(query);
    requestQuery = this._applyPopulation(requestQuery);
    requestQuery = this._applySort(requestQuery, { createdAt: -1 });
    return requestQuery;
  }

  async listGuardianRequests(filters = {}, context = {}) {
    const schoolId = context.schoolId;
    const tutorId = context.tutorId;
    const accountId = context.accountId;

    const linksQuery = this.GuardianAccessLinkModel.find({
      school_id: schoolId,
      guardianAccessAccountId: accountId,
      tutorId,
      status: 'active',
    });
    const links = await this._applySelect(linksQuery, 'studentId');
    const allowedStudentIds = [...new Set(
      (Array.isArray(links) ? links : []).map((link) => this._extractId(link.studentId)).filter(Boolean)
    )];

    if (!allowedStudentIds.length) {
      return [];
    }

    const studentId = normalizeString(filters.studentId);
    if (studentId && !allowedStudentIds.includes(studentId)) {
      throw createHttpError('O responsavel nao possui acesso para o aluno informado.', 403, {
        code: 'guardian_scope_denied',
      });
    }

    const query = {
      schoolId,
      studentId: studentId || { $in: allowedStudentIds },
      $or: [
        { requesterType: 'guardian', requesterId: tutorId },
        { targetGuardianIds: tutorId },
      ],
    };

    if (normalizeString(filters.documentType)) query.documentType = normalizeOfficialDocumentType(filters.documentType);
    if (normalizeString(filters.status)) query.status = normalizeString(filters.status);

    let requestQuery = this.OfficialDocumentRequestModel.find(query);
    requestQuery = this._applyPopulation(requestQuery);
    requestQuery = this._applySort(requestQuery, { createdAt: -1 });
    return requestQuery;
  }

  async listStudentRequests(filters = {}, context = {}) {
    const schoolId = context.schoolId;
    const studentId = context.studentId;
    const normalizedFilterStudentId = normalizeString(filters.studentId);

    if (normalizedFilterStudentId && normalizedFilterStudentId !== String(studentId)) {
      throw createHttpError('O aluno autenticado so pode listar as proprias solicitacoes.', 403, {
        code: 'student_scope_denied',
      });
    }

    const query = {
      schoolId,
      studentId,
      $or: [
        { requesterType: 'student', requesterId: studentId },
        { requesterType: 'school' },
      ],
    };

    if (normalizeString(filters.documentType)) query.documentType = normalizeOfficialDocumentType(filters.documentType);
    if (normalizeString(filters.status)) query.status = normalizeString(filters.status);

    let requestQuery = this.OfficialDocumentRequestModel.find(query);
    requestQuery = this._applyPopulation(requestQuery);
    requestQuery = this._applySort(requestQuery, { createdAt: -1 });
    return requestQuery;
  }

  async getSchoolRequestById(id, schoolId) {
    return this._getRequestDocument(id, schoolId, { populate: true });
  }

  async getGuardianRequestById(id, context = {}) {
    const request = await this._getRequestDocument(id, context.schoolId, { populate: true });
    await this._assertGuardianAccess({
      schoolId: context.schoolId,
      accountId: context.accountId,
      tutorId: context.tutorId,
      studentId: this._extractId(request.studentId),
    });

    const isAllowed = (
      (request.requesterType === 'guardian' && String(request.requesterId) === String(context.tutorId))
      || (Array.isArray(request.targetGuardianIds) && request.targetGuardianIds
        .map((guardian) => this._extractId(guardian))
        .includes(String(context.tutorId)))
    );

    if (!isAllowed) {
      throw createHttpError('A solicitacao nao esta disponivel para este responsavel.', 403, {
        code: 'guardian_request_denied',
      });
    }

    return request;
  }

  async getStudentRequestById(id, context = {}) {
    const request = await this._getRequestDocument(id, context.schoolId, { populate: true });
    if (String(this._extractId(request.studentId)) !== String(context.studentId)) {
      throw createHttpError('A solicitacao nao pertence ao aluno autenticado.', 403, {
        code: 'student_request_denied',
      });
    }

    const isAllowed = (
      (request.requesterType === 'student' && String(request.requesterId) === String(context.studentId))
      || request.requesterType === 'school'
    );

    if (!isAllowed) {
      throw createHttpError('A solicitacao nao esta disponivel para este aluno.', 403, {
        code: 'student_request_scope_denied',
      });
    }

    return request;
  }

  async approveRequest(id, payload = {}, context = {}) {
    const request = await this._getRequestDocument(id, context.schoolId);
    await this._ensureNoIssuedDocuments(request._id, context.schoolId);
    const previousStatus = request.status;

    this._setStatus(request, 'approved', {
      actorType: 'school',
      actorId: context.actorId,
    }, {
      eventType: 'request_approved',
      note: normalizeString(payload.notes),
    });

    request.approvedBy = buildActorContext('school', context.actorId);
    request.approvedAt = this._getNow();
    request.rejectedBy = null;
    request.rejectedAt = null;
    request.rejectionReason = null;

    const result = await this._saveAndReload(request, context.schoolId);
    this._emitRequestStatusEvents(result, {
      fromStatus: previousStatus,
      action: 'approved',
    });
    return result;
  }

  async rejectRequest(id, payload = {}, context = {}) {
    const request = await this._getRequestDocument(id, context.schoolId);
    await this._ensureNoIssuedDocuments(request._id, context.schoolId);
    const previousStatus = request.status;

    const rejectionReason = normalizeString(payload.rejectionReason || payload.reason);
    if (!rejectionReason) {
      throw createHttpError('rejectionReason e obrigatorio para rejeitar a solicitacao.', 400, {
        code: 'rejection_reason_required',
      });
    }

    this._setStatus(request, 'rejected', {
      actorType: 'school',
      actorId: context.actorId,
    }, {
      eventType: 'request_rejected',
      note: rejectionReason,
    });

    request.rejectedBy = buildActorContext('school', context.actorId);
    request.rejectedAt = this._getNow();
    request.rejectionReason = rejectionReason;

    const result = await this._saveAndReload(request, context.schoolId);
    this._emitRequestStatusEvents(result, {
      fromStatus: previousStatus,
      action: 'rejected',
    });
    return result;
  }

  async cancelSchoolRequest(id, payload = {}, context = {}) {
    const request = await this._getRequestDocument(id, context.schoolId);
    await this._ensureNoIssuedDocuments(request._id, context.schoolId);
    const previousStatus = request.status;

    const cancellationReason = normalizeString(payload.cancellationReason || payload.reason);
    this._setStatus(request, 'cancelled', {
      actorType: 'school',
      actorId: context.actorId,
    }, {
      eventType: 'request_cancelled',
      note: cancellationReason,
    });

    request.cancelledBy = buildActorContext('school', context.actorId);
    request.cancelledAt = this._getNow();
    request.cancellationReason = cancellationReason;

    const result = await this._saveAndReload(request, context.schoolId);
    this._emitRequestStatusEvents(result, {
      fromStatus: previousStatus,
      action: 'cancelled_by_school',
    });
    return result;
  }

  async cancelOwnRequest(id, payload = {}, context = {}) {
    const actorType = context.actorType;
    const actorId = context.actorId;
    const request = await this._getRequestDocument(id, context.schoolId);
    await this._ensureNoIssuedDocuments(request._id, context.schoolId);
    const previousStatus = request.status;

    if (request.requesterType !== actorType || String(request.requesterId) !== String(actorId)) {
      throw createHttpError('Somente o solicitante original pode cancelar esta solicitacao.', 403, {
        code: 'request_owner_required',
      });
    }

    const cancellationReason = normalizeString(payload.cancellationReason || payload.reason);
    this._setStatus(request, 'cancelled', {
      actorType,
      actorId,
    }, {
      eventType: 'request_cancelled',
      note: cancellationReason,
    });

    request.cancelledBy = buildActorContext(actorType, actorId);
    request.cancelledAt = this._getNow();
    request.cancellationReason = cancellationReason;

    const reloaded = await request.save();
    let result;
    if (actorType === 'guardian') {
      result = await this.getGuardianRequestById(reloaded._id, context);
    } else {
      result = await this.getStudentRequestById(reloaded._id, context);
    }

    this._emitRequestStatusEvents(result, {
      fromStatus: previousStatus,
      action: `cancelled_by_${actorType}`,
    });
    return result;
  }

  async updateSchoolRequestStatus(id, payload = {}, context = {}) {
    const request = await this._getRequestDocument(id, context.schoolId);
    await this._ensureNoIssuedDocuments(request._id, context.schoolId);
    const previousStatus = request.status;

    const nextStatus = normalizeString(payload.status);
    if (!nextStatus) {
      throw createHttpError('status e obrigatorio.', 400, {
        code: 'status_required',
      });
    }

    assertEnumValue(nextStatus, OFFICIAL_DOCUMENT_REQUEST_STATUSES, 'status');

    if (['approved', 'rejected', 'cancelled'].includes(nextStatus)) {
      throw createHttpError(
        'Use os endpoints dedicados para aprovar, rejeitar ou cancelar a solicitacao.',
        400,
        { code: 'dedicated_transition_required' }
      );
    }

    this._setStatus(request, nextStatus, {
      actorType: 'school',
      actorId: context.actorId,
    }, {
      eventType: 'request_status_updated',
      note: normalizeString(payload.notes),
    });

    const result = await this._saveAndReload(request, context.schoolId);
    this._emitRequestStatusEvents(result, {
      fromStatus: previousStatus,
      action: 'status_updated_by_school',
    });
    return result;
  }

  async syncStatusFromDocumentLifecycle(payload = {}) {
    if (!payload.requestId || !payload.schoolId) {
      return null;
    }

    const request = await this.OfficialDocumentRequestModel.findOne({
      _id: payload.requestId,
      schoolId: payload.schoolId,
    });

    if (!request) {
      return null;
    }

    const actor = this._normalizeActor(payload.actor);
    const previousStatus = request.status;
    this._setStatus(request, payload.nextStatus, actor, {
      eventType: payload.eventType || 'request_status_synced_from_document',
      note: normalizeString(payload.note),
      metadata: payload.metadata || null,
      overrideTransition: payload.overrideTransition === true,
    });

    if (payload.nextStatus === 'cancelled') {
      request.cancelledBy = buildActorContext(actor.actorType, actor.actorId);
      request.cancelledAt = this._getNow();
      if (normalizeString(payload.note)) {
        request.cancellationReason = normalizeString(payload.note);
      }
    }

    await request.save();
    this._emitRequestStatusEvents(request, {
      fromStatus: previousStatus,
      action: payload.eventType || 'request_status_synced_from_document',
      metadata: payload.metadata || null,
    });
    return request;
  }
}

const officialDocumentRequestService = new OfficialDocumentRequestService();

module.exports = officialDocumentRequestService;
module.exports.OfficialDocumentRequestService = OfficialDocumentRequestService;
