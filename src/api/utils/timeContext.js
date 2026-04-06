const DEFAULT_TIME_ZONE =
  process.env.SCHOOL_TIMEZONE ||
  process.env.SCHOOL_NOTIFICATION_TIMEZONE ||
  'America/Sao_Paulo';

function normalizeWhatsappPhone(phone) {
  let number = String(phone || '').replace(/\D/g, '');

  if (!number) {
    return '';
  }

  if (!number.startsWith('55') && (number.length === 10 || number.length === 11)) {
    number = `55${number}`;
  }

  return number;
}

function getTimeZoneParts(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getTimeZoneOffsetMs(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = getTimeZoneParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  );

  return zonedAsUtc - date.getTime();
}

function parseBusinessDateInput(
  value,
  timeZone = DEFAULT_TIME_ZONE,
  { hour = 12, minute = 0, second = 0, millisecond = 0 } = {}
) {
  if (!value) return null;

  if (value instanceof Date) {
    const clone = new Date(value);
    return Number.isNaN(clone.getTime()) ? null : clone;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return zonedTimeToUtc(
      {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour,
        minute,
        second,
        millisecond,
      },
      timeZone
    );
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shiftBusinessDate(
  referenceDate = new Date(),
  offsetDays = 0,
  timeZone = DEFAULT_TIME_ZONE,
  { hour = 12, minute = 0, second = 0, millisecond = 0 } = {}
) {
  const parts = getTimeZoneParts(referenceDate, timeZone);
  return zonedTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day + offsetDays,
      hour,
      minute,
      second,
      millisecond,
    },
    timeZone
  );
}

function getBusinessMonthRange(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = getTimeZoneParts(date, timeZone);
  const startOfMonth = zonedTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    timeZone
  );

  const nextMonthStart = parts.month === 12
    ? zonedTimeToUtc(
        {
          year: parts.year + 1,
          month: 1,
          day: 1,
          hour: 0,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        timeZone
      )
    : zonedTimeToUtc(
        {
          year: parts.year,
          month: parts.month + 1,
          day: 1,
          hour: 0,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        timeZone
      );

  return {
    startOfMonth,
    endOfMonth: new Date(nextMonthStart.getTime() - 1),
    businessMonthKey: [
      String(parts.year).padStart(4, '0'),
      String(parts.month).padStart(2, '0'),
    ].join('-'),
    timeZone,
  };
}

function getBusinessDayDifference(
  dueDate,
  referenceDate = new Date(),
  timeZone = DEFAULT_TIME_ZONE
) {
  const dueParts = getTimeZoneParts(dueDate, timeZone);
  const refParts = getTimeZoneParts(referenceDate, timeZone);
  const dueKey = Date.UTC(dueParts.year, dueParts.month - 1, dueParts.day);
  const refKey = Date.UTC(refParts.year, refParts.month - 1, refParts.day);
  return Math.round((dueKey - refKey) / (24 * 60 * 60 * 1000));
}

function zonedTimeToUtc(
  { year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 },
  timeZone = DEFAULT_TIME_ZONE
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

function getBusinessDayKey(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = getTimeZoneParts(date, timeZone);

  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

function getBusinessDayRange(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = getTimeZoneParts(date, timeZone);
  const startOfDay = zonedTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    timeZone
  );

  const nextDayStart = zonedTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day + 1,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    timeZone
  );

  return {
    startOfDay,
    endOfDay: new Date(nextDayStart.getTime() - 1),
    businessDayKey: getBusinessDayKey(date, timeZone),
    timeZone,
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  normalizeWhatsappPhone,
  getTimeZoneParts,
  getTimeZoneOffsetMs,
  zonedTimeToUtc,
  parseBusinessDateInput,
  shiftBusinessDate,
  getBusinessMonthRange,
  getBusinessDayDifference,
  getBusinessDayKey,
  getBusinessDayRange,
};
