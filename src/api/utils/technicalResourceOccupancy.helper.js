const { hasValue, parseTimeToMinutes } = require('../services/technicalOfferingMath.helper');
const { normalizeReferenceId } = require('./technicalScheduleSlot');

function normalizeTextKey(value) {
    if (!hasValue(value)) {
        return null;
    }

    return String(value)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, '-');
}

function normalizeWeekday(value) {
    if (!hasValue(value)) {
        return null;
    }

    const weekday = Number(value);
    if (!Number.isInteger(weekday)) {
        return null;
    }

    if (weekday === 0) {
        return 7;
    }

    if (weekday >= 1 && weekday <= 7) {
        return weekday;
    }

    return null;
}

function normalizeLegacyRoomLabel(value) {
    return normalizeTextKey(value);
}

function normalizeResourceKey(resourceType, value) {
    if (resourceType === 'teacher') {
        const teacherId = normalizeReferenceId(value);
        return teacherId ? `teacher:${teacherId}` : null;
    }

    if (resourceType === 'space') {
        const roomLabel = normalizeLegacyRoomLabel(value);
        return roomLabel ? `space:${roomLabel}` : null;
    }

    return null;
}

function normalizeTimeWindow(slot = {}) {
    const weekday = normalizeWeekday(slot.weekday);
    const startTime = typeof slot.startTime === 'string' ? slot.startTime.trim() : '';
    const endTime = typeof slot.endTime === 'string' ? slot.endTime.trim() : '';
    const startMinutes = parseTimeToMinutes(startTime);
    const endMinutes = parseTimeToMinutes(endTime);

    return {
        weekday,
        startTime,
        endTime,
        startMinutes,
        endMinutes
    };
}

function slotTimesOverlap(slotA = {}, slotB = {}) {
    const timeA = normalizeTimeWindow(slotA);
    const timeB = normalizeTimeWindow(slotB);

    if (timeA.weekday === null || timeB.weekday === null || timeA.weekday !== timeB.weekday) {
        return false;
    }

    if (
        timeA.startMinutes === null
        || timeA.endMinutes === null
        || timeB.startMinutes === null
        || timeB.endMinutes === null
    ) {
        return false;
    }

    return timeA.startMinutes < timeB.endMinutes && timeB.startMinutes < timeA.endMinutes;
}

function buildResourceKey(resourceType, value) {
    return normalizeResourceKey(resourceType, value);
}

function buildOccupancyFingerprint({ resourceType, resourceKey, weekday, startTime, endTime }) {
    return [
        resourceType || '',
        resourceKey || '',
        normalizeWeekday(weekday) || '',
        startTime || '',
        endTime || ''
    ].join('|');
}

module.exports = {
    normalizeTextKey,
    normalizeWeekday,
    normalizeLegacyRoomLabel,
    normalizeResourceKey,
    normalizeTimeWindow,
    slotTimesOverlap,
    buildResourceKey,
    buildOccupancyFingerprint
};
