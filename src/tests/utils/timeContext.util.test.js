const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getBusinessDayRange,
  getBusinessMonthRange,
  parseBusinessDateInput,
  shiftBusinessDate,
} = require('../../api/utils/timeContext');

test('parseBusinessDateInput keeps YYYY-MM-DD on the same business day in America/Sao_Paulo', () => {
  const parsed = parseBusinessDateInput('2026-04-06', 'America/Sao_Paulo');
  const range = getBusinessDayRange(parsed, 'America/Sao_Paulo');

  assert.equal(range.businessDayKey, '2026-04-06');
});

test('shiftBusinessDate advances business day without UTC drift', () => {
  const base = parseBusinessDateInput('2026-04-06', 'America/Sao_Paulo');
  const shifted = shiftBusinessDate(base, 1, 'America/Sao_Paulo', { hour: 12 });
  const range = getBusinessDayRange(shifted, 'America/Sao_Paulo');

  assert.equal(range.businessDayKey, '2026-04-07');
});

test('getBusinessMonthRange returns the current business month boundaries in America/Sao_Paulo', () => {
  const reference = parseBusinessDateInput('2026-04-06', 'America/Sao_Paulo');
  const range = getBusinessMonthRange(reference, 'America/Sao_Paulo');

  assert.equal(range.businessMonthKey, '2026-04');
  assert.equal(getBusinessDayRange(range.startOfMonth, 'America/Sao_Paulo').businessDayKey, '2026-04-01');
  assert.equal(getBusinessDayRange(range.endOfMonth, 'America/Sao_Paulo').businessDayKey, '2026-04-30');
});
