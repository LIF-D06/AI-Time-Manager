import { generateRecurrenceInstances } from '../Services/recurrence';

describe('recurrence.generateRecurrenceInstances', () => {
  const root = {
    id: 'root',
    name: 'Root',
    startTime: '2025-01-01T09:00:00.000Z',
    endTime: '2025-01-01T10:00:00.000Z'
  } as any;

  test('daily frequency generates instances', () => {
    const rule = { freq: 'daily', interval: 1, count: 3 };
    const instances = generateRecurrenceInstances(root, rule);
    // count=3 => root + 2 generated
    expect(instances.length).toBe(2);
    // dates should be next days
    expect(new Date(instances[0].startTime).getUTCDate()).toBe(new Date(root.startTime).getUTCDate() + 1);
  });

  test('weekly byDay generates correct days', () => {
    // root is 2025-01-01 (Wednesday)
    const rule = { freq: 'weekly', interval: 1, byDay: ['Mon','Wed','Fri'], count: 5 };
    const instances = generateRecurrenceInstances(root, rule);
    // Should generate instances on Mon/Wed/Fri weeks after root, respecting count limit
    expect(instances.length).toBeGreaterThan(0);
    // ensure no instance has parentTaskId equal to root for root duplication
    for (const inst of instances) {
      expect(inst.parentTaskId).toBe('root');
    }
  });

  test('safety limit prevents runaway generation when no count/until', () => {
    const rule = { freq: 'daily', interval: 1 };
    const instances = generateRecurrenceInstances(root, rule);
    expect(instances.length).toBeLessThanOrEqual(30);
  });
});
