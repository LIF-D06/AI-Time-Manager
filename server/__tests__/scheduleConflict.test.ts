import { findConflictingTasks, assertNoConflict, ScheduleConflictError } from '../Services/scheduleConflict';

describe('scheduleConflict', () => {
  const base = [
    { id: 'a', startTime: '2025-01-01T09:00:00.000Z', endTime: '2025-01-01T10:00:00.000Z' },
    { id: 'b', startTime: '2025-01-01T10:00:00.000Z', endTime: '2025-01-01T11:00:00.000Z' },
  ];

  test('no overlap when half-open and touching', () => {
    const candidate = { id: 'c', startTime: '2025-01-01T11:00:00.000Z', endTime: '2025-01-01T12:00:00.000Z' };
    const conflicts = findConflictingTasks(base, candidate, { boundaryConflict: false });
    expect(conflicts).toHaveLength(0);
  });

  test('detect overlap when boundary inclusive and touching', () => {
    const candidate = { id: 'c', startTime: '2025-01-01T10:00:00.000Z', endTime: '2025-01-01T10:30:00.000Z' };
    const conflicts = findConflictingTasks(base, candidate, { boundaryConflict: true });
    // boundary inclusive treats touching as conflict; both 'a' (ends at 10:00) and 'b' (starts at 10:00) conflict
    expect(conflicts).toHaveLength(2);
    const ids = conflicts.map(c => c.id).sort();
    expect(ids).toEqual(['a','b']);
  });

  test('assertNoConflict throws ScheduleConflictError when conflicts exist', () => {
    const candidate = { id: 'c', startTime: '2025-01-01T09:30:00.000Z', endTime: '2025-01-01T09:45:00.000Z' };
    expect(() => assertNoConflict(base, candidate)).toThrow(ScheduleConflictError);
  });

  test('invalid dates produce no conflicts', () => {
    const candidate = { id: 'c', startTime: 'invalid', endTime: 'also-invalid' };
    const conflicts = findConflictingTasks(base, candidate);
    expect(conflicts).toHaveLength(0);
  });
});
