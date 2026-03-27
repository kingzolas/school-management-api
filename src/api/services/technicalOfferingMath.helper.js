function hasValue(value) {
    return value !== undefined && value !== null && value !== '';
}

function parseDate(value) {
    if (!hasValue(value)) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function parseTimeToMinutes(time) {
    if (!hasValue(time) || typeof time !== 'string') {
        return null;
    }

    const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
    if (!match) {
        return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }

    return hours * 60 + minutes;
}

function calculateDurationMinutes(startTime, endTime) {
    const start = parseTimeToMinutes(startTime);
    const end = parseTimeToMinutes(endTime);

    if (start === null || end === null) {
        return null;
    }

    if (end <= start) {
        return null;
    }

    return end - start;
}

function computeModuleDerivedValues(plannedWorkloadHours, scheduleSlots, estimatedStartDate) {
    const plannedWeeklyMinutes = scheduleSlots.reduce((total, slot) => total + (slot.durationMinutes || 0), 0);

    let estimatedWeeks = null;
    let estimatedEndDate = null;
    const startDate = parseDate(estimatedStartDate);

    if (plannedWeeklyMinutes > 0 && hasValue(plannedWorkloadHours)) {
        estimatedWeeks = Number(((plannedWorkloadHours * 60) / plannedWeeklyMinutes).toFixed(2));
    }

    if (startDate && estimatedWeeks !== null) {
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + Math.ceil(estimatedWeeks * 7));
        estimatedEndDate = endDate;
    }

    return {
        plannedWeeklyMinutes,
        estimatedWeeks,
        estimatedStartDate: startDate,
        estimatedEndDate
    };
}

module.exports = {
    hasValue,
    parseDate,
    parseTimeToMinutes,
    calculateDurationMinutes,
    computeModuleDerivedValues
};
