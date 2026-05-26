const test = require('node:test');
const assert = require('node:assert/strict');

const attendanceService = require('../../api/services/attendance.service');
const classAccessService = require('../../api/services/classAccess.service');

function daysFromToday(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(0, 0, 0, 0);
  return date;
}

test('attendance permissions allow regular teacher only on current day', () => {
  const teacher = { roles: ['Professor'] };

  const today = attendanceService.getAttendancePermissions(teacher, daysFromToday(0));
  const yesterday = attendanceService.getAttendancePermissions(teacher, daysFromToday(-1));
  const tomorrow = attendanceService.getAttendancePermissions(teacher, daysFromToday(1));

  assert.equal(today.canCreate, true);
  assert.equal(today.canEdit, true);
  assert.equal(yesterday.canCreate, false);
  assert.equal(yesterday.canEdit, false);
  assert.equal(yesterday.isRetroactive, true);
  assert.match(yesterday.permissionReason, /retroativas/i);
  assert.equal(tomorrow.canCreate, false);
  assert.equal(tomorrow.canEdit, false);
});

test('attendance permissions allow administrative roles on retroactive dates', () => {
  for (const role of ['Admin', 'Coordenador', 'Gestor', 'Secretaria', 'Secretario', 'Staff']) {
    const permissions = attendanceService.getAttendancePermissions(
      { roles: [role] },
      daysFromToday(-10)
    );

    assert.equal(permissions.canCreate, true, role);
    assert.equal(permissions.canEdit, true, role);
    assert.equal(permissions.isRetroactive, true, role);
    assert.equal(classAccessService.isPrivilegedActor({ roles: [role] }), true, role);
  }
});

test('attendance date key keeps the selected civil date', () => {
  assert.equal(attendanceService.formatDateKey('2026-05-03T23:59:59.000Z'), '2026-05-03');
  assert.equal(attendanceService.formatDateKey('2026-05-03'), '2026-05-03');
});
