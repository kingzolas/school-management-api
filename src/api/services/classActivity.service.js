const mongoose = require('mongoose');

const ClassActivity = require('../models/classActivity.model');
const ClassActivitySubmission = require('../models/classActivitySubmission.model');
const Enrollment = require('../models/enrollment.model');
const Horario = require('../models/horario.model');
const Subject = require('../models/subject.model');
const {
  createHttpError,
  ensureClassAccess,
  extractId,
  isPrivilegedActor,
} = require('./classAccess.service');

const ACTIVITY_STATUSES = new Set([
  'PLANNED',
  'ACTIVE',
  'IN_REVIEW',
  'COMPLETED',
  'CANCELLED',
]);

const ACTIVITY_TYPES = new Set([
  'HOMEWORK',
  'CLASSWORK',
  'PROJECT',
  'READING',
  'PRACTICE',
  'CUSTOM',
]);

const SOURCE_TYPES = new Set([
  'BOOK',
  'NOTEBOOK',
  'WORKSHEET',
  'PROJECT',
  'FREE',
  'OTHER',
]);

const DELIVERY_STATUSES = new Set([
  'PENDING',
  'DELIVERED',
  'PARTIAL',
  'NOT_DELIVERED',
  'EXCUSED',
]);

const ACTIVITY_POPULATION = [
  { path: 'classId', select: 'name grade shift schoolYear' },
  { path: 'teacherId', select: 'fullName profilePictureUrl' },
  { path: 'subjectId', select: 'name level' },
];

const SUBMISSION_POPULATION = [
  {
    path: 'studentId',
    select: 'fullName enrollmentNumber profilePictureUrl photoUrl',
  },
  {
    path: 'enrollmentId',
    select: 'academicYear enrollmentDate status',
  },
];

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function parseDateValue(value, fieldLabel, { allowNull = false } = {}) {
  if (value === undefined) return undefined;

  if (value === null || value === '') {
    if (allowNull) return null;
    throw createHttpError(`${fieldLabel} e obrigatorio.`, 400);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(`${fieldLabel} invalido.`, 400);
  }

  return parsed;
}

function parseBooleanValue(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return Boolean(value);
}

function parseNullableScore(value, fieldLabel) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw createHttpError(`${fieldLabel} deve ser um numero valido.`, 400);
  }

  return parsed;
}

function normalizeEnumValue(value, allowedValues, fieldLabel, defaultValue) {
  const raw =
    value === undefined || value === null || value === ''
      ? defaultValue
      : String(value).trim().toUpperCase();

  if (!allowedValues.has(raw)) {
    throw createHttpError(`${fieldLabel} invalido.`, 400);
  }

  return raw;
}

function normalizeObjectId(value, fieldLabel, { allowNull = false } = {}) {
  if (value === undefined) return undefined;

  if (value === null || value === '') {
    if (allowNull) return null;
    throw createHttpError(`${fieldLabel} e obrigatorio.`, 400);
  }

  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw createHttpError(`${fieldLabel} invalido.`, 400);
  }

  return String(value);
}

function buildActivityTitle(input = {}) {
  const explicitTitle = normalizeText(input.title);
  if (explicitTitle) return explicitTitle;

  const sourceReference = normalizeText(input.sourceReference);
  if (sourceReference) return sourceReference;

  const description = normalizeText(input.description);
  if (description) {
    return description.length > 80 ? `${description.slice(0, 77)}...` : description;
  }

  return 'Atividade da turma';
}

function computeDefaultStoredStatus({ assignedAt }) {
  const now = new Date();
  return assignedAt && assignedAt.getTime() > now.getTime() ? 'PLANNED' : 'ACTIVE';
}

function roundToTwo(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculateSummaryFromSubmissions(submissions = []) {
  const summary = {
    totalStudents: submissions.length,
    deliveredCount: 0,
    partialCount: 0,
    notDeliveredCount: 0,
    excusedCount: 0,
    pendingCount: 0,
    correctedCount: 0,
    pendingCorrectionCount: 0,
    gradedCount: 0,
    averageScore: null,
  };

  let totalScore = 0;

  for (const submission of submissions) {
    switch (submission.deliveryStatus) {
      case 'DELIVERED':
        summary.deliveredCount += 1;
        break;
      case 'PARTIAL':
        summary.partialCount += 1;
        break;
      case 'NOT_DELIVERED':
        summary.notDeliveredCount += 1;
        break;
      case 'EXCUSED':
        summary.excusedCount += 1;
        break;
      case 'PENDING':
      default:
        summary.pendingCount += 1;
        break;
    }

    if (submission.isCorrected) {
      summary.correctedCount += 1;
    }

    if (submission.deliveryStatus !== 'PENDING' && submission.isCorrected !== true) {
      summary.pendingCorrectionCount += 1;
    }

    if (submission.score !== null && submission.score !== undefined) {
      summary.gradedCount += 1;
      totalScore += Number(submission.score);
    }
  }

  if (summary.gradedCount > 0) {
    summary.averageScore = roundToTwo(totalScore / summary.gradedCount);
  }

  return summary;
}

function computeWorkflowState(activity) {
  const status = activity?.status || 'ACTIVE';
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'COMPLETED') return 'COMPLETED';

  const summary = activity?.summary || {};
  const totalStudents = Number(summary.totalStudents || 0);
  const correctedCount = Number(summary.correctedCount || 0);
  const pendingCorrectionCount = Number(summary.pendingCorrectionCount || 0);
  const now = new Date();

  if (totalStudents > 0 && correctedCount >= totalStudents && pendingCorrectionCount === 0) {
    return 'COMPLETED';
  }

  if (activity?.assignedAt && new Date(activity.assignedAt).getTime() > now.getTime()) {
    return 'PLANNED';
  }

  const correctionReference = activity?.correctionDate || activity?.dueDate;
  if (correctionReference && new Date(correctionReference).getTime() <= now.getTime()) {
    return 'IN_REVIEW';
  }

  return 'ACTIVE';
}

function serializeActivity(doc) {
  if (!doc) return null;

  const activity =
    typeof doc.toObject === 'function'
      ? doc.toObject({ virtuals: false })
      : { ...doc };

  return {
    id: extractId(activity._id),
    title: activity.title,
    description: activity.description || '',
    activityType: activity.activityType,
    sourceType: activity.sourceType,
    sourceReference: activity.sourceReference || '',
    isGraded: Boolean(activity.isGraded),
    maxScore: activity.maxScore ?? null,
    assignedAt: activity.assignedAt || null,
    dueDate: activity.dueDate || null,
    correctionDate: activity.correctionDate || null,
    status: activity.status,
    workflowState: computeWorkflowState(activity),
    visibilityToGuardians: Boolean(activity.visibilityToGuardians),
    summary: activity.summary || {
      totalStudents: 0,
      deliveredCount: 0,
      partialCount: 0,
      notDeliveredCount: 0,
      excusedCount: 0,
      pendingCount: 0,
      correctedCount: 0,
      pendingCorrectionCount: 0,
      gradedCount: 0,
      averageScore: null,
    },
    class: activity.classId
      ? {
          id: extractId(activity.classId),
          name: activity.classId.name || '',
          grade: activity.classId.grade || '',
          shift: activity.classId.shift || '',
          schoolYear: activity.classId.schoolYear ?? activity.academicYear ?? null,
        }
      : {
          id: extractId(activity.classId),
          name: '',
          grade: '',
          shift: '',
          schoolYear: activity.academicYear ?? null,
        },
    teacher: activity.teacherId
      ? {
          id: extractId(activity.teacherId),
          fullName: activity.teacherId.fullName || '',
          profilePictureUrl: activity.teacherId.profilePictureUrl || null,
        }
      : {
          id: extractId(activity.teacherId),
          fullName: '',
          profilePictureUrl: null,
        },
    subject: activity.subjectId
      ? {
          id: extractId(activity.subjectId),
          name: activity.subjectId.name || '',
          level: activity.subjectId.level || '',
        }
      : null,
    createdAt: activity.createdAt || null,
    updatedAt: activity.updatedAt || null,
  };
}

function serializeSubmission(doc, currentMemberStudentIds) {
  const submission =
    typeof doc.toObject === 'function'
      ? doc.toObject({ virtuals: false })
      : { ...doc };

  const studentId = extractId(submission.studentId);
  const currentStudentSet = currentMemberStudentIds || new Set();

  return {
    id: extractId(submission._id),
    student: {
      id: studentId,
      fullName: submission.studentId?.fullName || '',
      enrollmentNumber: submission.studentId?.enrollmentNumber || '',
      profilePictureUrl:
        submission.studentId?.profilePictureUrl ||
        submission.studentId?.photoUrl ||
        null,
    },
    enrollment: submission.enrollmentId
      ? {
          id: extractId(submission.enrollmentId),
          academicYear: submission.enrollmentId.academicYear ?? null,
          enrollmentDate: submission.enrollmentId.enrollmentDate || null,
          status: submission.enrollmentId.status || '',
        }
      : null,
    deliveryStatus: submission.deliveryStatus,
    submittedAt: submission.submittedAt || null,
    isCorrected: Boolean(submission.isCorrected),
    correctedAt: submission.correctedAt || null,
    score: submission.score ?? null,
    teacherNote: submission.teacherNote || '',
    isCurrentClassMember: currentStudentSet.has(studentId),
  };
}

class ClassActivityService {
  _getActorId(actor) {
    return extractId(actor?.id || actor?._id);
  }

  async _validateSubjectAccess({ schoolId, classId, subjectId, actor }) {
    if (!subjectId) return null;

    const subject = await Subject.findOne({
      _id: subjectId,
      school_id: schoolId,
    }).select('_id name level');

    if (!subject) {
      throw createHttpError(
        'Disciplina nao encontrada ou nao pertence a esta escola.',
        404
      );
    }

    if (!isPrivilegedActor(actor)) {
      const teacherId = this._getActorId(actor);

      const ownsSubjectInClass = await Horario.exists({
        school_id: schoolId,
        classId,
        teacherId,
        subjectId,
      });

      if (!ownsSubjectInClass) {
        throw createHttpError(
          'Disciplina nao encontrada na sua grade para esta turma.',
          403
        );
      }
    }

    return subject;
  }

  async _getActivityDocument(activityId, schoolId, { populate = false } = {}) {
    if (!activityId || !mongoose.Types.ObjectId.isValid(activityId)) {
      throw createHttpError('Atividade invalida.', 400);
    }

    const query = ClassActivity.findOne({
      _id: activityId,
      schoolId,
    });

    if (populate) {
      query.populate(ACTIVITY_POPULATION);
    }

    const activity = await query;

    if (!activity) {
      throw createHttpError('Atividade nao encontrada.', 404);
    }

    return activity;
  }

  async _ensureActivityAccess(activity, actor, schoolId) {
    await ensureClassAccess(actor, schoolId, activity.classId);

    if (isPrivilegedActor(actor)) {
      return activity;
    }

    const actorId = this._getActorId(actor);
    if (!actorId || extractId(activity.teacherId) !== actorId) {
      throw createHttpError('Atividade nao encontrada.', 404);
    }

    return activity;
  }

  async _syncSubmissionsWithRoster(activity) {
    const enrollments = await Enrollment.find({
      school_id: activity.schoolId,
      class: activity.classId,
      status: 'Ativa',
    })
      .select('_id student')
      .lean();

    const existingSubmissions = await ClassActivitySubmission.find({
      activityId: activity._id,
    })
      .select('studentId')
      .lean();

    const existingStudentIds = new Set(
      existingSubmissions.map((item) => extractId(item.studentId)).filter(Boolean)
    );

    const bulkOps = enrollments
      .filter((enrollment) => {
        const studentId = extractId(enrollment.student);
        return studentId && !existingStudentIds.has(studentId);
      })
      .map((enrollment) => ({
        updateOne: {
          filter: {
            activityId: activity._id,
            studentId: enrollment.student,
          },
          update: {
            $setOnInsert: {
              schoolId: activity.schoolId,
              classId: activity.classId,
              activityId: activity._id,
              teacherId: activity.teacherId,
              studentId: enrollment.student,
              enrollmentId: enrollment._id,
              deliveryStatus: 'PENDING',
              submittedAt: null,
              isCorrected: false,
              correctedAt: null,
              score: null,
              teacherNote: '',
            },
          },
          upsert: true,
        },
      }));

    if (bulkOps.length > 0) {
      await ClassActivitySubmission.bulkWrite(bulkOps);
    }

    return enrollments;
  }

  async _recalculateSummary(activityId) {
    const submissions = await ClassActivitySubmission.find({ activityId })
      .select('deliveryStatus isCorrected score')
      .lean();

    const summary = calculateSummaryFromSubmissions(submissions);

    await ClassActivity.findByIdAndUpdate(activityId, {
      $set: {
        summary,
        lastSubmissionSyncAt: new Date(),
      },
    });

    return summary;
  }

  async _prepareCreatePayload({ schoolId, classDoc, actor, data }) {
    const assignedAt =
      parseDateValue(data.assignedAt, 'assignedAt', { allowNull: true }) ||
      new Date();
    const dueDate = parseDateValue(data.dueDate, 'dueDate');
    const correctionDate = parseDateValue(data.correctionDate, 'correctionDate', {
      allowNull: true,
    });

    if (dueDate.getTime() < assignedAt.getTime()) {
      throw createHttpError('dueDate nao pode ser anterior a assignedAt.', 400);
    }

    if (correctionDate && correctionDate.getTime() < dueDate.getTime()) {
      throw createHttpError(
        'correctionDate nao pode ser anterior a dueDate.',
        400
      );
    }

    const normalizedSubjectId =
      normalizeObjectId(data.subjectId, 'subjectId', { allowNull: true }) || null;

    await this._validateSubjectAccess({
      schoolId,
      classId: classDoc._id,
      subjectId: normalizedSubjectId,
      actor,
    });

    const explicitTeacherId = normalizeObjectId(data.teacherId, 'teacherId', {
      allowNull: true,
    });

    const actorId = this._getActorId(actor);
    if (!actorId) {
      throw createHttpError('Usuario autenticado invalido.', 403);
    }

    let teacherId = explicitTeacherId || actorId;

    if (!isPrivilegedActor(actor) && teacherId !== actorId) {
      throw createHttpError(
        'Voce nao pode criar atividade para outro professor.',
        403
      );
    }

    const requestedMaxScore = parseNullableScore(data.maxScore, 'maxScore');
    let isGraded = parseBooleanValue(data.isGraded, false);

    if (requestedMaxScore !== undefined && requestedMaxScore !== null) {
      isGraded = true;
    }

    return {
      schoolId,
      classId: classDoc._id,
      teacherId,
      createdById: actorId,
      subjectId: normalizedSubjectId,
      academicYear: Number(classDoc.schoolYear || new Date().getFullYear()),
      title: buildActivityTitle(data),
      description: normalizeText(data.description),
      activityType: normalizeEnumValue(
        data.activityType,
        ACTIVITY_TYPES,
        'activityType',
        'HOMEWORK'
      ),
      sourceType: normalizeEnumValue(
        data.sourceType,
        SOURCE_TYPES,
        'sourceType',
        'FREE'
      ),
      sourceReference: normalizeText(data.sourceReference),
      isGraded,
      maxScore: isGraded ? requestedMaxScore ?? 10 : null,
      assignedAt,
      dueDate,
      correctionDate: correctionDate || null,
      status: normalizeEnumValue(
        data.status,
        ACTIVITY_STATUSES,
        'status',
        computeDefaultStoredStatus({ assignedAt })
      ),
      visibilityToGuardians: parseBooleanValue(
        data.visibilityToGuardians,
        false
      ),
    };
  }

  async _prepareUpdatePayload({ activity, actor, data }) {
    const updateData = {};

    if (hasOwn(data, 'subjectId')) {
      const normalizedSubjectId = normalizeObjectId(data.subjectId, 'subjectId', {
        allowNull: true,
      });

      await this._validateSubjectAccess({
        schoolId: activity.schoolId,
        classId: activity.classId,
        subjectId: normalizedSubjectId,
        actor,
      });

      updateData.subjectId = normalizedSubjectId;
    }

    if (hasOwn(data, 'title')) {
      updateData.title = buildActivityTitle({
        title: data.title,
        sourceReference: hasOwn(data, 'sourceReference')
          ? data.sourceReference
          : activity.sourceReference,
        description: hasOwn(data, 'description')
          ? data.description
          : activity.description,
      });
    }

    if (hasOwn(data, 'description')) {
      updateData.description = normalizeText(data.description);
    }

    if (hasOwn(data, 'activityType')) {
      updateData.activityType = normalizeEnumValue(
        data.activityType,
        ACTIVITY_TYPES,
        'activityType',
        activity.activityType
      );
    }

    if (hasOwn(data, 'sourceType')) {
      updateData.sourceType = normalizeEnumValue(
        data.sourceType,
        SOURCE_TYPES,
        'sourceType',
        activity.sourceType
      );
    }

    if (hasOwn(data, 'sourceReference')) {
      updateData.sourceReference = normalizeText(data.sourceReference);
    }

    let nextAssignedAt = activity.assignedAt;
    if (hasOwn(data, 'assignedAt')) {
      nextAssignedAt =
        parseDateValue(data.assignedAt, 'assignedAt', { allowNull: true }) ||
        activity.assignedAt;
      updateData.assignedAt = nextAssignedAt;
    }

    let nextDueDate = activity.dueDate;
    if (hasOwn(data, 'dueDate')) {
      nextDueDate = parseDateValue(data.dueDate, 'dueDate');
      updateData.dueDate = nextDueDate;
    }

    if (nextDueDate && nextAssignedAt && nextDueDate.getTime() < nextAssignedAt.getTime()) {
      throw createHttpError('dueDate nao pode ser anterior a assignedAt.', 400);
    }

    if (hasOwn(data, 'correctionDate')) {
      const nextCorrectionDate = parseDateValue(
        data.correctionDate,
        'correctionDate',
        { allowNull: true }
      );

      if (
        nextCorrectionDate &&
        nextDueDate &&
        nextCorrectionDate.getTime() < nextDueDate.getTime()
      ) {
        throw createHttpError(
          'correctionDate nao pode ser anterior a dueDate.',
          400
        );
      }

      updateData.correctionDate = nextCorrectionDate;
    }

    const currentlyGraded = Boolean(activity.isGraded);
    let nextIsGraded = currentlyGraded;

    if (hasOwn(data, 'isGraded')) {
      nextIsGraded = parseBooleanValue(data.isGraded, currentlyGraded);
      updateData.isGraded = nextIsGraded;
    }

    const requestedMaxScore = hasOwn(data, 'maxScore')
      ? parseNullableScore(data.maxScore, 'maxScore')
      : undefined;

    if (
      requestedMaxScore !== undefined &&
      requestedMaxScore !== null &&
      !hasOwn(data, 'isGraded')
    ) {
      nextIsGraded = true;
      updateData.isGraded = true;
    }

    if (!nextIsGraded) {
      const existingScoredSubmission = await ClassActivitySubmission.exists({
        activityId: activity._id,
        score: { $ne: null },
      });

      if (existingScoredSubmission) {
        throw createHttpError(
          'Nao e possivel remover a pontuacao de uma atividade que ja possui notas lancadas.',
          400
        );
      }

      if (hasOwn(data, 'isGraded') || hasOwn(data, 'maxScore')) {
        updateData.isGraded = false;
        updateData.maxScore = null;
      }
    } else if (hasOwn(data, 'isGraded') || hasOwn(data, 'maxScore')) {
      const nextMaxScore = requestedMaxScore ?? activity.maxScore ?? 10;

      if (nextMaxScore === null) {
        updateData.maxScore = 10;
      } else {
        const scoreAboveLimit = await ClassActivitySubmission.exists({
          activityId: activity._id,
          score: { $gt: nextMaxScore },
        });

        if (scoreAboveLimit) {
          throw createHttpError(
            'Existe nota acima do novo maxScore informado.',
            400
          );
        }

        updateData.maxScore = nextMaxScore;
      }
    }

    if (hasOwn(data, 'status')) {
      updateData.status = normalizeEnumValue(
        data.status,
        ACTIVITY_STATUSES,
        'status',
        activity.status
      );
    }

    if (hasOwn(data, 'visibilityToGuardians')) {
      updateData.visibilityToGuardians = parseBooleanValue(
        data.visibilityToGuardians,
        activity.visibilityToGuardians
      );
    }

    return updateData;
  }

  async createForClass({ schoolId, classId, actor, data }) {
    const classDoc = await ensureClassAccess(actor, schoolId, classId);
    const payload = await this._prepareCreatePayload({
      schoolId,
      classDoc,
      actor,
      data,
    });

    const activity = await ClassActivity.create(payload);
    await this._syncSubmissionsWithRoster(activity);
    const summary = await this._recalculateSummary(activity._id);

    const populatedActivity = await this._getActivityDocument(activity._id, schoolId, {
      populate: true,
    });
    populatedActivity.summary = summary;

    return serializeActivity(populatedActivity);
  }

  async listByClass({ schoolId, classId, actor, filters = {} }) {
    await ensureClassAccess(actor, schoolId, classId);

    const query = {
      schoolId,
      classId,
    };

    if (!isPrivilegedActor(actor)) {
      query.teacherId = this._getActorId(actor);
    } else if (filters.teacherId) {
      query.teacherId = normalizeObjectId(filters.teacherId, 'teacherId');
    }

    if (filters.status) {
      query.status = normalizeEnumValue(
        filters.status,
        ACTIVITY_STATUSES,
        'status',
        'ACTIVE'
      );
    }

    if (filters.subjectId) {
      query.subjectId = normalizeObjectId(filters.subjectId, 'subjectId');
    }

    if (filters.isGraded !== undefined) {
      query.isGraded = parseBooleanValue(filters.isGraded, false);
    }

    if (filters.from || filters.to) {
      query.dueDate = {};

      if (filters.from) {
        query.dueDate.$gte = parseDateValue(filters.from, 'from');
      }

      if (filters.to) {
        query.dueDate.$lte = parseDateValue(filters.to, 'to');
      }
    }

    const search = normalizeText(filters.search || filters.q);
    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { title: regex },
        { description: regex },
        { sourceReference: regex },
      ];
    }

    const items = await ClassActivity.find(query)
      .populate(ACTIVITY_POPULATION)
      .sort({ dueDate: 1, assignedAt: 1, createdAt: -1 });

    return {
      total: items.length,
      items: items.map((item) => serializeActivity(item)),
    };
  }

  async getById({ schoolId, activityId, actor }) {
    const activity = await this._getActivityDocument(activityId, schoolId);
    await this._ensureActivityAccess(activity, actor, schoolId);
    await this._syncSubmissionsWithRoster(activity);
    const summary = await this._recalculateSummary(activity._id);

    const populatedActivity = await this._getActivityDocument(activity._id, schoolId, {
      populate: true,
    });
    populatedActivity.summary = summary;

    return serializeActivity(populatedActivity);
  }

  async update({ schoolId, activityId, actor, data }) {
    const activity = await this._getActivityDocument(activityId, schoolId);
    await this._ensureActivityAccess(activity, actor, schoolId);

    const updateData = await this._prepareUpdatePayload({
      activity,
      actor,
      data,
    });

    const updated = await ClassActivity.findOneAndUpdate(
      { _id: activity._id, schoolId },
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate(ACTIVITY_POPULATION);

    return serializeActivity(updated);
  }

  async cancel({ schoolId, activityId, actor }) {
    const activity = await this._getActivityDocument(activityId, schoolId);
    await this._ensureActivityAccess(activity, actor, schoolId);

    const cancelled = await ClassActivity.findOneAndUpdate(
      { _id: activity._id, schoolId },
      { $set: { status: 'CANCELLED' } },
      { new: true }
    ).populate(ACTIVITY_POPULATION);

    return serializeActivity(cancelled);
  }

  async getSubmissions({ schoolId, activityId, actor }) {
    const activity = await this._getActivityDocument(activityId, schoolId);
    await this._ensureActivityAccess(activity, actor, schoolId);

    const activeEnrollments = await this._syncSubmissionsWithRoster(activity);
    const summary = await this._recalculateSummary(activity._id);

    const populatedActivity = await this._getActivityDocument(activity._id, schoolId, {
      populate: true,
    });
    populatedActivity.summary = summary;

    const submissions = await ClassActivitySubmission.find({
      activityId: activity._id,
    })
      .populate(SUBMISSION_POPULATION)
      .sort({ createdAt: 1, studentId: 1 });

    const currentStudentIds = new Set(
      activeEnrollments.map((item) => extractId(item.student)).filter(Boolean)
    );

    const students = submissions
      .map((item) => serializeSubmission(item, currentStudentIds))
      .sort((left, right) =>
        String(left.student.fullName || '').localeCompare(
          String(right.student.fullName || ''),
          'pt-BR',
          { sensitivity: 'base' }
        )
      );

    return {
      activity: serializeActivity(populatedActivity),
      totalStudents: students.length,
      students,
    };
  }

  async bulkUpsertSubmissions({ schoolId, activityId, actor, updates }) {
    if (!Array.isArray(updates) || updates.length === 0) {
      throw createHttpError('Lista de atualizacoes vazia.', 400);
    }

    const activity = await this._getActivityDocument(activityId, schoolId);
    await this._ensureActivityAccess(activity, actor, schoolId);

    if (activity.status === 'CANCELLED') {
      throw createHttpError(
        'Nao e possivel atualizar entregas de uma atividade cancelada.',
        400
      );
    }

    const activeEnrollments = await this._syncSubmissionsWithRoster(activity);

    const submissions = await ClassActivitySubmission.find({
      activityId: activity._id,
    })
      .select(
        '_id studentId enrollmentId deliveryStatus submittedAt isCorrected correctedAt score teacherNote'
      )
      .lean();

    const submissionByStudentId = new Map(
      submissions.map((item) => [extractId(item.studentId), item])
    );

    const enrollmentByStudentId = new Map(
      activeEnrollments.map((item) => [extractId(item.student), extractId(item._id)])
    );
    const studentByEnrollmentId = new Map(
      activeEnrollments.map((item) => [extractId(item._id), extractId(item.student)])
    );

    const now = new Date();
    const bulkOps = [];

    for (const rawUpdate of updates) {
      const requestedStudentId = normalizeObjectId(
        rawUpdate.studentId,
        'studentId',
        { allowNull: true }
      );
      const requestedEnrollmentId = normalizeObjectId(
        rawUpdate.enrollmentId,
        'enrollmentId',
        { allowNull: true }
      );

      const resolvedStudentId =
        requestedStudentId ||
        (requestedEnrollmentId ? studentByEnrollmentId.get(requestedEnrollmentId) : null);

      if (!resolvedStudentId) {
        throw createHttpError(
          'Cada atualizacao precisa informar studentId ou enrollmentId valido.',
          400
        );
      }

      const existing = submissionByStudentId.get(resolvedStudentId);
      if (!existing) {
        throw createHttpError(
          'Aluno nao encontrado entre as entregas da atividade.',
          404
        );
      }

      const finalDeliveryStatus = hasOwn(rawUpdate, 'deliveryStatus')
        ? normalizeEnumValue(
            rawUpdate.deliveryStatus,
            DELIVERY_STATUSES,
            'deliveryStatus',
            existing.deliveryStatus || 'PENDING'
          )
        : existing.deliveryStatus;

      let finalSubmittedAt;
      if (hasOwn(rawUpdate, 'submittedAt')) {
        finalSubmittedAt = parseDateValue(rawUpdate.submittedAt, 'submittedAt', {
          allowNull: true,
        });
      } else if (
        hasOwn(rawUpdate, 'deliveryStatus') &&
        (finalDeliveryStatus === 'DELIVERED' || finalDeliveryStatus === 'PARTIAL')
      ) {
        finalSubmittedAt = existing.submittedAt || now;
      } else if (
        hasOwn(rawUpdate, 'deliveryStatus') &&
        (finalDeliveryStatus === 'NOT_DELIVERED' ||
          finalDeliveryStatus === 'EXCUSED' ||
          finalDeliveryStatus === 'PENDING')
      ) {
        finalSubmittedAt = null;
      } else {
        finalSubmittedAt = existing.submittedAt || null;
      }

      const explicitScore = hasOwn(rawUpdate, 'score')
        ? parseNullableScore(rawUpdate.score, 'score')
        : undefined;

      if (explicitScore !== undefined && explicitScore !== null && !activity.isGraded) {
        throw createHttpError('Esta atividade nao aceita nota.', 400);
      }

      if (
        explicitScore !== undefined &&
        explicitScore !== null &&
        activity.maxScore !== null &&
        explicitScore > activity.maxScore
      ) {
        throw createHttpError(
          'A nota informada nao pode ultrapassar o maxScore da atividade.',
          400
        );
      }

      let finalIsCorrected = hasOwn(rawUpdate, 'isCorrected')
        ? parseBooleanValue(rawUpdate.isCorrected, existing.isCorrected)
        : existing.isCorrected;

      if (
        hasOwn(rawUpdate, 'deliveryStatus') &&
        !hasOwn(rawUpdate, 'isCorrected') &&
        (finalDeliveryStatus === 'PENDING' ||
          finalDeliveryStatus === 'NOT_DELIVERED' ||
          finalDeliveryStatus === 'EXCUSED')
      ) {
        finalIsCorrected = false;
      }

      if (explicitScore !== undefined && explicitScore !== null && !hasOwn(rawUpdate, 'isCorrected')) {
        finalIsCorrected = true;
      }

      if (finalIsCorrected === false && explicitScore !== undefined && explicitScore !== null) {
        throw createHttpError('score exige isCorrected=true.', 400);
      }

      let finalCorrectedAt;
      if (hasOwn(rawUpdate, 'correctedAt')) {
        finalCorrectedAt = parseDateValue(rawUpdate.correctedAt, 'correctedAt', {
          allowNull: true,
        });
      } else if (finalIsCorrected && !existing.correctedAt) {
        finalCorrectedAt = now;
      } else if (!finalIsCorrected) {
        finalCorrectedAt = null;
      } else {
        finalCorrectedAt = existing.correctedAt || null;
      }

      let finalScore;
      if (explicitScore !== undefined) {
        finalScore = explicitScore;
      } else if (!finalIsCorrected) {
        finalScore = null;
      } else {
        finalScore = existing.score ?? null;
      }

      const finalTeacherNote = hasOwn(rawUpdate, 'teacherNote')
        ? normalizeText(rawUpdate.teacherNote)
        : existing.teacherNote || '';

      const finalEnrollmentId =
        requestedEnrollmentId ||
        extractId(existing.enrollmentId) ||
        enrollmentByStudentId.get(resolvedStudentId) ||
        null;

      bulkOps.push({
        updateOne: {
          filter: { _id: existing._id },
          update: {
            $set: {
              enrollmentId: finalEnrollmentId,
              deliveryStatus: finalDeliveryStatus,
              submittedAt: finalSubmittedAt,
              isCorrected: finalIsCorrected,
              correctedAt: finalCorrectedAt,
              score: finalScore,
              teacherNote: finalTeacherNote,
            },
          },
        },
      });
    }

    if (bulkOps.length > 0) {
      await ClassActivitySubmission.bulkWrite(bulkOps);
    }

    await this._recalculateSummary(activity._id);

    return this.getSubmissions({ schoolId, activityId, actor });
  }
}

module.exports = new ClassActivityService();
