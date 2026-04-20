const OfficialDocument = require('../models/officialDocument.model');
const Student = require('../models/student.model');
const GuardianAccessLink = require('../models/guardianAccessLink.model');
const officialDocumentRequestService = require('./officialDocumentRequest.service');
const officialDocumentStorageService = require('./officialDocumentStorage.service');
const appEmitter = require('../../loaders/eventEmitter');
const {
  OFFICIAL_DOCUMENT_REALTIME_EVENTS,
  emitDocumentEvent,
} = require('./officialDocumentRealtime.service');
const {
  OFFICIAL_DOCUMENT_STATUSES,
  OFFICIAL_DOCUMENT_TRANSITIONS,
  OFFICIAL_DOCUMENT_SIGNATURE_PROVIDERS,
  assertEnumValue,
  assertTransition,
  buildAuditEvent,
  createHttpError,
  hasOwn,
  hasValue,
  normalizeOfficialDocumentType,
  normalizeObjectIdList,
  normalizeString,
  parseBoolean,
} = require('../validators/officialDocument.validator');

const documentPopulation = [
  { path: 'studentId', select: 'fullName enrollmentNumber birthDate cpf' },
  { path: 'guardianIds', select: 'fullName cpf phoneNumber email' },
  { path: 'requestId', select: 'status requesterType purpose reason targetGuardianIds createdAt updatedAt' },
  { path: 'generatedByUserId', select: 'fullName email roles status' },
  { path: 'signedByUserId', select: 'fullName email roles status' },
  { path: 'publishedByUserId', select: 'fullName email roles status' },
  { path: 'supersedesDocumentId', select: 'status version documentType publishedAt' },
  { path: 'replacedByDocumentId', select: 'status version documentType publishedAt' },
];

class OfficialDocumentService {
  constructor(options = {}) {
    this.OfficialDocumentModel = options.OfficialDocumentModel || OfficialDocument;
    this.StudentModel = options.StudentModel || Student;
    this.GuardianAccessLinkModel =
      options.GuardianAccessLinkModel || GuardianAccessLink;
    this.requestService = options.requestService || officialDocumentRequestService;
    this.storageService = options.storageService || officialDocumentStorageService;
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

  _applyPopulation(query, population = documentPopulation) {
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

  _appendAuditEvent(document, payload) {
    if (!Array.isArray(document.auditTrail)) {
      document.auditTrail = [];
    }

    document.auditTrail.push(buildAuditEvent(payload));
  }

  _emitDocumentEvent(eventName, document, extra = {}) {
    emitDocumentEvent(this.eventEmitter, eventName, document, extra);
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

  _resolveDocumentGuardianIds(student, requestRecord, explicitGuardianIds) {
    const studentGuardianIds = this._collectStudentGuardianIds(student);
    const normalizedExplicitIds = normalizeObjectIdList(explicitGuardianIds);

    if (normalizedExplicitIds.length > 0) {
      const invalidGuardianId = normalizedExplicitIds.find(
        (guardianId) => !studentGuardianIds.includes(guardianId)
      );

      if (invalidGuardianId) {
        throw createHttpError(
          'Existe responsavel informado no documento que nao pertence ao aluno selecionado.',
          400,
          { code: 'guardian_not_linked_to_student', guardianId: invalidGuardianId }
        );
      }

      return normalizedExplicitIds;
    }

    if (Array.isArray(requestRecord?.targetGuardianIds) && requestRecord.targetGuardianIds.length) {
      return normalizeObjectIdList(requestRecord.targetGuardianIds);
    }

    return studentGuardianIds;
  }

  async _loadGuardianStudentScope(context = {}) {
    const query = this.GuardianAccessLinkModel.find({
      school_id: context.schoolId,
      guardianAccessAccountId: context.accountId,
      tutorId: context.tutorId,
      status: 'active',
    });
    const links = await this._applySelect(query, 'studentId');
    const studentIds = [...new Set(
      (Array.isArray(links) ? links : []).map((link) => this._extractId(link.studentId)).filter(Boolean)
    )];

    return {
      links: Array.isArray(links) ? links : [],
      studentIds,
    };
  }

  async _assertGuardianAccessToStudent(context = {}, studentId) {
    const query = this.GuardianAccessLinkModel.findOne({
      school_id: context.schoolId,
      guardianAccessAccountId: context.accountId,
      tutorId: context.tutorId,
      studentId,
      status: 'active',
    });
    const link = await this._applySelect(query, '_id');

    if (!link) {
      throw createHttpError(
        'O responsavel autenticado nao possui acesso ativo para este aluno.',
        403,
        { code: 'guardian_access_denied' }
      );
    }
  }

  async _getDocumentRecord(id, schoolId, options = {}) {
    let query = this.OfficialDocumentModel.findOne({
      _id: id,
      schoolId,
    });

    if (options.includeFileData) {
      query = this._applySelect(query, '+fileData');
    }

    if (options.populate) {
      query = this._applyPopulation(query);
    }

    const document = await query;

    if (!document) {
      throw createHttpError('Documento oficial nao encontrado.', 404, {
        code: 'official_document_not_found',
      });
    }

    return document;
  }

  async _saveAndReload(document, schoolId) {
    await document.save();
    return this.getSchoolDocumentById(document._id, schoolId);
  }

  _setStatus(document, nextStatus, actor, options = {}) {
    const normalizedActor = this._normalizeActor(actor);
    const previousStatus = document.status;
    const shouldOverride = options.overrideTransition === true;

    if (!shouldOverride) {
      assertTransition(
        OFFICIAL_DOCUMENT_TRANSITIONS,
        previousStatus,
        nextStatus,
        'status do documento'
      );
    }

    if (previousStatus !== nextStatus) {
      document.status = nextStatus;
      document.lastStatusChangedAt = this._getNow();
    }

    this._appendAuditEvent(document, {
      eventType: options.eventType || 'document_status_updated',
      actorType: normalizedActor.actorType,
      actorId: normalizedActor.actorId,
      fromStatus: previousStatus,
      toStatus: nextStatus,
      note: options.note || null,
      metadata: options.metadata || null,
      occurredAt: this._getNow(),
    });
  }

  _parseOptionalDate(value, fieldLabel) {
    if (!hasValue(value)) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw createHttpError(`${fieldLabel} invalido.`, 400, {
        code: `${fieldLabel}_invalid`,
      });
    }

    return parsed;
  }

  async _buildSignedDocument(payload = {}, file, context = {}) {
    const schoolId = context.schoolId;
    const actorId = context.actorId;
    const requestRecord = context.requestRecord || null;
    const studentId = payload.studentId
      || context.studentId
      || this._extractId(requestRecord?.studentId);
    const student = await this._loadStudent(studentId, schoolId);

    if (requestRecord && String(this._extractId(requestRecord.studentId)) !== String(this._extractId(student._id))) {
      throw createHttpError('A solicitacao vinculada pertence a outro aluno.', 409, {
        code: 'request_student_mismatch',
      });
    }

    const documentType = normalizeOfficialDocumentType(payload.documentType)
      || normalizeOfficialDocumentType(requestRecord?.documentType);
    if (!documentType) {
      throw createHttpError('documentType e obrigatorio.', 400, {
        code: 'document_type_required',
      });
    }

    if (
      requestRecord
      && normalizeOfficialDocumentType(requestRecord.documentType)
      && normalizeOfficialDocumentType(requestRecord.documentType) !== documentType
    ) {
      throw createHttpError('O documentType do arquivo nao corresponde ao da solicitacao vinculada.', 409, {
        code: 'request_document_type_mismatch',
      });
    }

    const signatureProvider = normalizeString(payload.signatureProvider) || 'local_windows_certificate';
    assertEnumValue(signatureProvider, OFFICIAL_DOCUMENT_SIGNATURE_PROVIDERS, 'signatureProvider');

    const document = new this.OfficialDocumentModel();
    const version = Number(payload.version || context.version || 1);
    const storedFile = this.storageService.storeSignedPdf(file, {
      schoolId,
      studentId: this._extractId(student._id),
      documentId: this._extractId(document._id),
      version,
      fallbackFileName: `${documentType}.pdf`,
    });

    const now = this._getNow();
    const generatedAt = this._parseOptionalDate(payload.generatedAt, 'generatedAt') || now;
    const signedAt = this._parseOptionalDate(payload.signedAt, 'signedAt') || now;
    const guardianIds = this._resolveDocumentGuardianIds(
      student,
      requestRecord,
      payload.guardianIds
    );

    Object.assign(document, {
      schoolId,
      studentId: this._extractId(student._id),
      guardianIds,
      requestId: requestRecord?._id || payload.requestId || null,
      documentType,
      status: 'signed',
      version,
      generatedByUserId: payload.generatedByUserId || actorId || null,
      signedByUserId: payload.signedByUserId || actorId || null,
      publishedByUserId: null,
      generatedAt,
      signedAt,
      publishedAt: null,
      downloadedAt: null,
      isVisibleToGuardian: parseBoolean(payload.isVisibleToGuardian, false),
      isVisibleToStudent: parseBoolean(payload.isVisibleToStudent, false),
      fileName: storedFile.fileName,
      mimeType: storedFile.mimeType,
      fileSize: storedFile.fileSize,
      fileHash: storedFile.fileHash,
      storageProvider: storedFile.storageProvider,
      storageKey: storedFile.storageKey,
      fileData: storedFile.fileData,
      certificateSubject: normalizeString(payload.certificateSubject),
      certificateSerialNumber: normalizeString(payload.certificateSerialNumber),
      signatureProvider,
      notes: normalizeString(payload.notes),
      supersedesDocumentId: context.supersedesDocumentId || null,
      replacedByDocumentId: null,
      lastStatusChangedAt: signedAt,
      auditTrail: [
        buildAuditEvent({
          eventType: 'document_signed_received',
          actorType: 'school',
          actorId,
          toStatus: 'signed',
          metadata: {
            requestId: requestRecord?._id || null,
            version,
            storageProvider: storedFile.storageProvider,
            storageKey: storedFile.storageKey,
            fileHash: storedFile.fileHash,
          },
          occurredAt: now,
        }),
      ],
    });

    await document.save();
    return document;
  }

  async registerSignedDocument(payload = {}, file, context = {}) {
    const schoolId = context.schoolId;
    const actorId = context.actorId;

    if (!schoolId || !actorId) {
      throw createHttpError('Contexto da escola nao informado para registrar o documento.', 403, {
        code: 'school_context_required',
      });
    }

    let requestRecord = null;
    const requestId = normalizeString(payload.requestId);
    if (requestId) {
      requestRecord = await this.requestService.getSchoolRequestById(requestId, schoolId);

      if (['rejected', 'cancelled'].includes(requestRecord.status)) {
        throw createHttpError(
          'Nao e permitido registrar documento para uma solicitacao rejeitada ou cancelada.',
          409,
          { code: 'request_not_active' }
        );
      }

      const existingDocument = await this.OfficialDocumentModel.exists({
        requestId,
        schoolId,
        status: { $in: ['signed', 'published'] },
      });

      if (existingDocument) {
        throw createHttpError(
          'Ja existe documento assinado ativo para esta solicitacao. Use o fluxo de substituicao.',
          409,
          { code: 'request_already_has_active_document' }
        );
      }
    }

    const document = await this._buildSignedDocument(payload, file, {
      schoolId,
      actorId,
      requestRecord,
      version: 1,
    });

    if (requestRecord?._id) {
      await this.requestService.syncStatusFromDocumentLifecycle({
        requestId: requestRecord._id,
        schoolId,
        nextStatus: 'signed',
        actor: {
          actorType: 'school',
          actorId,
        },
        eventType: 'request_document_signed_received',
        metadata: {
          documentId: document._id,
          version: document.version,
        },
      });
    }

    const result = await this.getSchoolDocumentById(document._id, schoolId);
    this._emitDocumentEvent(OFFICIAL_DOCUMENT_REALTIME_EVENTS.signed, result, {
      action: 'signed_pdf_received',
      toStatus: result.status,
    });
    return result;
  }

  async listSchoolDocuments(filters = {}, schoolId) {
    const query = { schoolId };

    if (normalizeString(filters.studentId)) query.studentId = normalizeString(filters.studentId);
    if (normalizeString(filters.documentType)) query.documentType = normalizeOfficialDocumentType(filters.documentType);
    if (normalizeString(filters.status)) query.status = normalizeString(filters.status);
    if (normalizeString(filters.requestId)) query.requestId = normalizeString(filters.requestId);

    if (hasOwn(filters, 'isVisibleToGuardian')) {
      query.isVisibleToGuardian = parseBoolean(filters.isVisibleToGuardian, false);
    }

    if (hasOwn(filters, 'isVisibleToStudent')) {
      query.isVisibleToStudent = parseBoolean(filters.isVisibleToStudent, false);
    }

    let documentQuery = this.OfficialDocumentModel.find(query);
    documentQuery = this._applyPopulation(documentQuery);
    documentQuery = this._applySort(documentQuery, { publishedAt: -1, signedAt: -1, createdAt: -1 });
    return documentQuery;
  }

  async listGuardianDocuments(filters = {}, context = {}) {
    const scope = await this._loadGuardianStudentScope(context);
    if (!scope.studentIds.length) return [];

    const requestedStudentId = normalizeString(filters.studentId);
    if (requestedStudentId && !scope.studentIds.includes(requestedStudentId)) {
      throw createHttpError('O responsavel nao possui acesso para o aluno informado.', 403, {
        code: 'guardian_scope_denied',
      });
    }

    const query = {
      schoolId: context.schoolId,
      studentId: requestedStudentId || { $in: scope.studentIds },
      status: 'published',
      isVisibleToGuardian: true,
      guardianIds: context.tutorId,
    };

    if (normalizeString(filters.documentType)) query.documentType = normalizeOfficialDocumentType(filters.documentType);

    let documentQuery = this.OfficialDocumentModel.find(query);
    documentQuery = this._applyPopulation(documentQuery);
    documentQuery = this._applySort(documentQuery, { publishedAt: -1, createdAt: -1 });
    return documentQuery;
  }

  async listStudentDocuments(filters = {}, context = {}) {
    const requestedStudentId = normalizeString(filters.studentId);
    if (requestedStudentId && requestedStudentId !== String(context.studentId)) {
      throw createHttpError('O aluno autenticado so pode listar os proprios documentos.', 403, {
        code: 'student_scope_denied',
      });
    }

    const query = {
      schoolId: context.schoolId,
      studentId: context.studentId,
      status: 'published',
      isVisibleToStudent: true,
    };

    if (normalizeString(filters.documentType)) query.documentType = normalizeOfficialDocumentType(filters.documentType);

    let documentQuery = this.OfficialDocumentModel.find(query);
    documentQuery = this._applyPopulation(documentQuery);
    documentQuery = this._applySort(documentQuery, { publishedAt: -1, createdAt: -1 });
    return documentQuery;
  }

  async getSchoolDocumentById(id, schoolId) {
    return this._getDocumentRecord(id, schoolId, { populate: true });
  }

  async getGuardianDocumentById(id, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId, { populate: true });
    const studentId = this._extractId(document.studentId);
    await this._assertGuardianAccessToStudent(context, studentId);

    const guardianIds = Array.isArray(document.guardianIds)
      ? document.guardianIds.map((guardian) => this._extractId(guardian))
      : [];

    if (
      document.status !== 'published'
      || document.isVisibleToGuardian !== true
      || !guardianIds.includes(String(context.tutorId))
    ) {
      throw createHttpError('Documento nao disponivel para este responsavel.', 403, {
        code: 'guardian_document_denied',
      });
    }

    return document;
  }

  async getStudentDocumentById(id, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId, { populate: true });

    if (
      String(this._extractId(document.studentId)) !== String(context.studentId)
      || document.status !== 'published'
      || document.isVisibleToStudent !== true
    ) {
      throw createHttpError('Documento nao disponivel para este aluno.', 403, {
        code: 'student_document_denied',
      });
    }

    return document;
  }

  async publishDocument(id, payload = {}, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId);

    this._setStatus(document, 'published', {
      actorType: 'school',
      actorId: context.actorId,
    }, {
      eventType: 'document_published',
      metadata: {
        isVisibleToGuardian: parseBoolean(
          payload.isVisibleToGuardian,
          document.isVisibleToGuardian
        ),
        isVisibleToStudent: parseBoolean(
          payload.isVisibleToStudent,
          document.isVisibleToStudent
        ),
      },
    });

    document.isVisibleToGuardian = parseBoolean(
      payload.isVisibleToGuardian,
      document.isVisibleToGuardian
    );
    document.isVisibleToStudent = parseBoolean(
      payload.isVisibleToStudent,
      document.isVisibleToStudent
    );
    document.publishedByUserId = context.actorId;
    document.publishedAt = this._parseOptionalDate(payload.publishedAt, 'publishedAt') || this._getNow();

    const reloaded = await this._saveAndReload(document, context.schoolId);

    if (reloaded.requestId?._id || document.requestId) {
      await this.requestService.syncStatusFromDocumentLifecycle({
        requestId: reloaded.requestId?._id || document.requestId,
        schoolId: context.schoolId,
        nextStatus: 'published',
        actor: {
          actorType: 'school',
          actorId: context.actorId,
        },
        eventType: 'request_document_published',
        metadata: {
          documentId: reloaded._id,
        },
      });
    }

    this._emitDocumentEvent(OFFICIAL_DOCUMENT_REALTIME_EVENTS.published, reloaded, {
      action: 'published_by_school',
      toStatus: reloaded.status,
    });
    return reloaded;
  }

  async updateVisibility(id, payload = {}, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId);

    if (!hasOwn(payload, 'isVisibleToGuardian') && !hasOwn(payload, 'isVisibleToStudent')) {
      throw createHttpError(
        'Informe isVisibleToGuardian e/ou isVisibleToStudent para atualizar a visibilidade.',
        400,
        { code: 'visibility_payload_required' }
      );
    }

    const nextVisibleToGuardian = hasOwn(payload, 'isVisibleToGuardian')
      ? parseBoolean(payload.isVisibleToGuardian, document.isVisibleToGuardian)
      : document.isVisibleToGuardian;
    const nextVisibleToStudent = hasOwn(payload, 'isVisibleToStudent')
      ? parseBoolean(payload.isVisibleToStudent, document.isVisibleToStudent)
      : document.isVisibleToStudent;

    document.isVisibleToGuardian = nextVisibleToGuardian;
    document.isVisibleToStudent = nextVisibleToStudent;
    this._appendAuditEvent(document, {
      eventType: 'document_visibility_updated',
      actorType: 'school',
      actorId: context.actorId,
      fromStatus: document.status,
      toStatus: document.status,
      metadata: {
        isVisibleToGuardian: nextVisibleToGuardian,
        isVisibleToStudent: nextVisibleToStudent,
      },
      occurredAt: this._getNow(),
    });

    return this._saveAndReload(document, context.schoolId);
  }

  async replaceDocument(id, payload = {}, file, context = {}) {
    const currentDocument = await this._getDocumentRecord(id, context.schoolId);

    if (!['signed', 'published'].includes(currentDocument.status)) {
      throw createHttpError(
        'Somente documentos assinados ou publicados podem ser substituidos por nova versao.',
        409,
        { code: 'document_replacement_not_allowed' }
      );
    }

    if (currentDocument.replacedByDocumentId) {
      throw createHttpError('Este documento ja possui uma versao substituta vinculada.', 409, {
        code: 'document_already_replaced',
      });
    }

    const nextVersion = Number(currentDocument.version || 1) + 1;
    const replacementPayload = {
      ...payload,
      studentId: this._extractId(currentDocument.studentId),
      requestId: this._extractId(currentDocument.requestId),
      documentType: currentDocument.documentType,
      guardianIds: hasOwn(payload, 'guardianIds')
        ? payload.guardianIds
        : (Array.isArray(currentDocument.guardianIds)
          ? currentDocument.guardianIds.map((guardian) => this._extractId(guardian))
          : []),
      isVisibleToGuardian: hasOwn(payload, 'isVisibleToGuardian')
        ? payload.isVisibleToGuardian
        : currentDocument.isVisibleToGuardian,
      isVisibleToStudent: hasOwn(payload, 'isVisibleToStudent')
        ? payload.isVisibleToStudent
        : currentDocument.isVisibleToStudent,
      notes: hasOwn(payload, 'notes') ? payload.notes : currentDocument.notes,
      certificateSubject: hasOwn(payload, 'certificateSubject')
        ? payload.certificateSubject
        : currentDocument.certificateSubject,
      certificateSerialNumber: hasOwn(payload, 'certificateSerialNumber')
        ? payload.certificateSerialNumber
        : currentDocument.certificateSerialNumber,
      signatureProvider: hasOwn(payload, 'signatureProvider')
        ? payload.signatureProvider
        : currentDocument.signatureProvider,
      generatedByUserId: hasOwn(payload, 'generatedByUserId')
        ? payload.generatedByUserId
        : currentDocument.generatedByUserId,
      signedByUserId: hasOwn(payload, 'signedByUserId')
        ? payload.signedByUserId
        : currentDocument.signedByUserId,
    };

    const replacementDocument = await this._buildSignedDocument(replacementPayload, file, {
      schoolId: context.schoolId,
      actorId: context.actorId,
      version: nextVersion,
      supersedesDocumentId: currentDocument._id,
    });

    this._setStatus(currentDocument, 'superseded', {
      actorType: 'school',
      actorId: context.actorId,
    }, {
      eventType: 'document_superseded',
      metadata: {
        replacedByDocumentId: replacementDocument._id,
        replacementVersion: replacementDocument.version,
      },
    });
    currentDocument.replacedByDocumentId = replacementDocument._id;
    await currentDocument.save();

    if (currentDocument.requestId) {
      await this.requestService.syncStatusFromDocumentLifecycle({
        requestId: currentDocument.requestId,
        schoolId: context.schoolId,
        nextStatus: 'signed',
        actor: {
          actorType: 'school',
          actorId: context.actorId,
        },
        eventType: 'request_document_replaced',
        metadata: {
          previousDocumentId: currentDocument._id,
          newDocumentId: replacementDocument._id,
          replacementVersion: replacementDocument.version,
        },
      });
    }

    const result = await this.getSchoolDocumentById(replacementDocument._id, context.schoolId);
    this._emitDocumentEvent(OFFICIAL_DOCUMENT_REALTIME_EVENTS.replaced, result, {
      action: 'replaced_by_new_version',
      previousDocumentId: currentDocument._id,
      newDocumentId: result._id,
      version: result.version,
    });
    this._emitDocumentEvent(OFFICIAL_DOCUMENT_REALTIME_EVENTS.signed, result, {
      action: 'replacement_signed_pdf_received',
      toStatus: result.status,
    });
    return result;
  }

  async _recordDownload(document, actor, options = {}) {
    const normalizedActor = this._normalizeActor(actor);
    const now = this._getNow();

    document.downloadedAt = now;
    this._appendAuditEvent(document, {
      eventType: 'document_downloaded',
      actorType: normalizedActor.actorType,
      actorId: normalizedActor.actorId,
      fromStatus: document.status,
      toStatus: document.status,
      metadata: options.metadata || null,
      occurredAt: now,
    });

    await document.save();

    if (options.syncRequestStatus === true && document.requestId) {
      await this.requestService.syncStatusFromDocumentLifecycle({
        requestId: document.requestId,
        schoolId: document.schoolId,
        nextStatus: 'downloaded',
        actor: normalizedActor,
        eventType: 'request_document_downloaded',
        metadata: {
          documentId: document._id,
          ...options.metadata,
        },
      });
    }

    this._emitDocumentEvent(OFFICIAL_DOCUMENT_REALTIME_EVENTS.downloaded, document, {
      action: 'download_recorded',
      actorType: normalizedActor.actorType,
      accessScope: options.metadata?.accessScope || null,
    });
    return document;
  }

  async recordSchoolDownload(id, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId);
    await this._recordDownload(document, {
      actorType: 'school',
      actorId: context.actorId,
    }, {
      syncRequestStatus: false,
      metadata: {
        accessScope: 'school',
      },
    });
    return this.getSchoolDocumentById(id, context.schoolId);
  }

  async recordGuardianDownload(id, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId);
    await this._assertGuardianAccessToStudent(context, this._extractId(document.studentId));

    const guardianIds = Array.isArray(document.guardianIds)
      ? document.guardianIds.map((guardian) => this._extractId(guardian))
      : [];

    if (
      document.status !== 'published'
      || document.isVisibleToGuardian !== true
      || !guardianIds.includes(String(context.tutorId))
    ) {
      throw createHttpError('Documento nao disponivel para este responsavel.', 403, {
        code: 'guardian_document_denied',
      });
    }

    await this._recordDownload(document, {
      actorType: 'guardian',
      actorId: context.tutorId,
    }, {
      syncRequestStatus: true,
      metadata: {
        accessScope: 'guardian',
      },
    });

    return this.getGuardianDocumentById(id, context);
  }

  async recordStudentDownload(id, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId);

    if (
      String(this._extractId(document.studentId)) !== String(context.studentId)
      || document.status !== 'published'
      || document.isVisibleToStudent !== true
    ) {
      throw createHttpError('Documento nao disponivel para este aluno.', 403, {
        code: 'student_document_denied',
      });
    }

    await this._recordDownload(document, {
      actorType: 'student',
      actorId: context.studentId,
    }, {
      syncRequestStatus: true,
      metadata: {
        accessScope: 'student',
      },
    });

    return this.getStudentDocumentById(id, context);
  }

  async downloadSchoolDocumentFile(id, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId, {
      includeFileData: true,
    });
    await this._recordDownload(document, {
      actorType: 'school',
      actorId: context.actorId,
    }, {
      syncRequestStatus: false,
      metadata: {
        accessScope: 'school',
      },
    });

    return this.storageService.readStoredPdf(document);
  }

  async downloadGuardianDocumentFile(id, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId, {
      includeFileData: true,
    });
    await this._assertGuardianAccessToStudent(context, this._extractId(document.studentId));

    const guardianIds = Array.isArray(document.guardianIds)
      ? document.guardianIds.map((guardian) => this._extractId(guardian))
      : [];

    if (
      document.status !== 'published'
      || document.isVisibleToGuardian !== true
      || !guardianIds.includes(String(context.tutorId))
    ) {
      throw createHttpError('Documento nao disponivel para este responsavel.', 403, {
        code: 'guardian_document_denied',
      });
    }

    await this._recordDownload(document, {
      actorType: 'guardian',
      actorId: context.tutorId,
    }, {
      syncRequestStatus: true,
      metadata: {
        accessScope: 'guardian',
      },
    });

    return this.storageService.readStoredPdf(document);
  }

  async downloadStudentDocumentFile(id, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId, {
      includeFileData: true,
    });

    if (
      String(this._extractId(document.studentId)) !== String(context.studentId)
      || document.status !== 'published'
      || document.isVisibleToStudent !== true
    ) {
      throw createHttpError('Documento nao disponivel para este aluno.', 403, {
        code: 'student_document_denied',
      });
    }

    await this._recordDownload(document, {
      actorType: 'student',
      actorId: context.studentId,
    }, {
      syncRequestStatus: true,
      metadata: {
        accessScope: 'student',
      },
    });

    return this.storageService.readStoredPdf(document);
  }

  async cancelDocument(id, payload = {}, context = {}) {
    const document = await this._getDocumentRecord(id, context.schoolId);

    if (['cancelled', 'superseded'].includes(document.status)) {
      throw createHttpError('O documento informado nao pode mais ser cancelado.', 409, {
        code: 'document_cancel_not_allowed',
      });
    }

    const cancellationReason = normalizeString(payload.reason || payload.notes || payload.cancellationReason);
    this._setStatus(document, 'cancelled', {
      actorType: 'school',
      actorId: context.actorId,
    }, {
      eventType: 'document_cancelled',
      note: cancellationReason,
    });

    document.isVisibleToGuardian = false;
    document.isVisibleToStudent = false;

    const reloaded = await this._saveAndReload(document, context.schoolId);

    if (reloaded.requestId?._id || document.requestId) {
      await this.requestService.syncStatusFromDocumentLifecycle({
        requestId: reloaded.requestId?._id || document.requestId,
        schoolId: context.schoolId,
        nextStatus: 'cancelled',
        actor: {
          actorType: 'school',
          actorId: context.actorId,
        },
        eventType: 'request_document_cancelled',
        note: cancellationReason,
        metadata: {
          documentId: reloaded._id,
        },
      });
    }

    this._emitDocumentEvent(OFFICIAL_DOCUMENT_REALTIME_EVENTS.cancelled, reloaded, {
      action: 'cancelled_by_school',
      toStatus: reloaded.status,
    });
    return reloaded;
  }
}

const officialDocumentService = new OfficialDocumentService();

module.exports = officialDocumentService;
module.exports.OfficialDocumentService = OfficialDocumentService;
