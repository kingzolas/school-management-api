const { hasValue, calculateDurationMinutes } = require('../services/technicalOfferingMath.helper');

const SLOT_PUBLICATION_STATUS = Object.freeze({
    DRAFT: 'draft',
    PUBLISHED: 'published'
});

const SLOT_PUBLICATION_AUDIT_REASON = Object.freeze({
    CRITICAL_CHANGE: 'critical_change'
});

function normalizeReferenceId(value) {
    if (!hasValue(value)) {
        return null;
    }

    if (typeof value === 'object' && value._id) {
        return String(value._id);
    }

    return String(value);
}

function normalizeTeacherIds(slot = {}) {
    const teacherRefs = [];

    if (hasValue(slot.teacherId)) {
        teacherRefs.push(slot.teacherId);
    }

    if (Array.isArray(slot.teacherIds)) {
        teacherRefs.push(...slot.teacherIds);
    }

    return [...new Set(teacherRefs.map(normalizeReferenceId).filter(Boolean))];
}

function stripPublicationState(slot = {}) {
    const {
        publicationStatus,
        publishedAt,
        publishedByUserId,
        publicationRevertedAt,
        publicationRevertedByUserId,
        publicationRevertedReason,
        ...rest
    } = slot;

    return rest;
}

function getScheduleSlotEffectiveSpaceId(slot = {}, parentOffering = null) {
    const effectiveSpace = slot?.spaceId || parentOffering?.defaultSpaceId || null;
    return slotFieldValue(effectiveSpace);
}

function slotFieldValue(value) {
    if (!hasValue(value)) {
        return null;
    }

    return normalizeReferenceId(value);
}

function compareNormalizedArrays(arrayA = [], arrayB = []) {
    const normalizedA = [...new Set(arrayA.map(normalizeReferenceId).filter(Boolean))].sort();
    const normalizedB = [...new Set(arrayB.map(normalizeReferenceId).filter(Boolean))].sort();

    if (normalizedA.length !== normalizedB.length) {
        return false;
    }

    return normalizedA.every((value, index) => value === normalizedB[index]);
}

function hasCriticalSlotChanges(previousSlot = {}, nextSlot = {}) {
    const previousTeacherIds = normalizeTeacherIds(previousSlot);
    const nextTeacherIds = normalizeTeacherIds(nextSlot);

    return (
        Number(previousSlot.weekday) !== Number(nextSlot.weekday)
        || String(previousSlot.startTime || '').trim() !== String(nextSlot.startTime || '').trim()
        || String(previousSlot.endTime || '').trim() !== String(nextSlot.endTime || '').trim()
        || slotFieldValue(previousSlot.spaceId) !== slotFieldValue(nextSlot.spaceId)
        || String(previousSlot.status || '') !== String(nextSlot.status || '')
        || !compareNormalizedArrays(previousTeacherIds, nextTeacherIds)
    );
}

function getScheduleSlotBlockingReasons(slot = {}, parentOffering = null) {
    const reasons = [];
    const publicationStatus = slot?.publicationStatus || SLOT_PUBLICATION_STATUS.DRAFT;
    const status = String(slot?.status || '').trim();
    const weekday = Number(slot?.weekday);
    const startTime = String(slot?.startTime || '').trim();
    const endTime = String(slot?.endTime || '').trim();
    const teacherIds = normalizeTeacherIds(slot);
    const effectiveSpaceId = getScheduleSlotEffectiveSpaceId(slot, parentOffering);
    const durationMinutes = calculateDurationMinutes(startTime, endTime);

    if (publicationStatus !== SLOT_PUBLICATION_STATUS.PUBLISHED) {
        reasons.push({
            code: 'SLOT_DRAFT',
            message: 'Slot em rascunho.'
        });
    }

    if (status !== 'Ativo') {
        reasons.push({
            code: 'SLOT_INACTIVE',
            message: 'Slot inativo.'
        });
    }

    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        reasons.push({
            code: 'INVALID_WEEKDAY',
            message: 'Dia da semana invalido.'
        });
    }

    if (!durationMinutes) {
        reasons.push({
            code: 'INVALID_TIME_RANGE',
            message: 'Horario inicial/final invalido.'
        });
    }

    if (teacherIds.length === 0) {
        reasons.push({
            code: 'MISSING_TEACHER',
            message: 'Slot sem professor definido.'
        });
    } else if (teacherIds.length > 1) {
        reasons.push({
            code: 'MULTIPLE_TEACHERS',
            message: 'Slot precisa ter apenas um professor.'
        });
    }

    if (!effectiveSpaceId) {
        reasons.push({
            code: 'MISSING_SPACE',
            message: 'Slot sem sala definida.'
        });
    }

    return reasons;
}

function getScheduleSlotReadState(slot = {}, parentOffering = null) {
    const blockingReasons = getScheduleSlotBlockingReasons(slot, parentOffering);

    return {
        blockingReasons,
        isOperational: blockingReasons.length === 0
    };
}

function resolveSlotPublicationState({
    currentSlot = null,
    nextSlot = {},
    performedByUserId = null,
    now = new Date()
}) {
    const currentPublicationStatus = currentSlot?.publicationStatus || SLOT_PUBLICATION_STATUS.DRAFT;
    const currentPublishedAt = currentSlot?.publishedAt || null;
    const currentPublishedByUserId = slotFieldValue(currentSlot?.publishedByUserId);
    const currentRevertedAt = currentSlot?.publicationRevertedAt || null;
    const currentRevertedByUserId = slotFieldValue(currentSlot?.publicationRevertedByUserId);
    const currentRevertedReason = currentSlot?.publicationRevertedReason || null;

    if (
        currentPublicationStatus === SLOT_PUBLICATION_STATUS.PUBLISHED
        && hasCriticalSlotChanges(currentSlot, nextSlot)
    ) {
        return {
            publicationStatus: SLOT_PUBLICATION_STATUS.DRAFT,
            publishedAt: null,
            publishedByUserId: null,
            publicationRevertedAt: now,
            publicationRevertedByUserId: slotFieldValue(performedByUserId),
            publicationRevertedReason: SLOT_PUBLICATION_AUDIT_REASON.CRITICAL_CHANGE
        };
    }

    return {
        publicationStatus: currentPublicationStatus,
        publishedAt: currentPublishedAt,
        publishedByUserId: currentPublishedByUserId,
        publicationRevertedAt: currentRevertedAt,
        publicationRevertedByUserId: currentRevertedByUserId,
        publicationRevertedReason: currentRevertedReason
    };
}

module.exports = {
    SLOT_PUBLICATION_STATUS,
    SLOT_PUBLICATION_AUDIT_REASON,
    normalizeReferenceId,
    normalizeTeacherIds,
    stripPublicationState,
    getScheduleSlotEffectiveSpaceId,
    getScheduleSlotBlockingReasons,
    getScheduleSlotReadState,
    hasCriticalSlotChanges,
    resolveSlotPublicationState
};
