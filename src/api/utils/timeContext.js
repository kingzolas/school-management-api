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
  getBusinessDayKey,
  getBusinessDayRange,
};
