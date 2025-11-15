import { v4 as uuidv4 } from 'uuid';
import { Task } from '../index';

export function generateRecurrenceInstances(root: Task, rule: any): Task[] {
  const instances: Task[] = [];
  try {
    const freq = rule.freq;
    const interval = rule.interval && rule.interval > 0 ? rule.interval : 1;
    const count: number | undefined = rule.count;
    const until: Date | undefined = rule.until ? new Date(rule.until) : undefined;
    const byDay: string[] | undefined = Array.isArray(rule.byDay) ? rule.byDay : undefined;
    const start = new Date(root.startTime);
    const end = new Date(root.endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return instances;
    const maxIterations = count ? count - 1 : 500; // root already counts as one
    let generated = 0;
    if (freq === 'daily') {
      let cursorStart = new Date(start);
      let cursorEnd = new Date(end);
      while (generated < maxIterations) {
        cursorStart.setDate(cursorStart.getDate() + interval);
        cursorEnd.setDate(cursorEnd.getDate() + interval);
        if (until && cursorStart > until) break;
        instances.push(buildInstance(root, cursorStart, cursorEnd));
        generated++;
        if (!count && until && cursorStart > until) break;
        if (!count && !until && generated >= 30) break;
      }
    } else if (freq === 'weekly') {
      const rootDay = start.getDay();
      const dayMap: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
      const byDayIdx = byDay?.map(d => dayMap[d])?.filter(d => d !== undefined) || [];
      let weekOffset = 0;
      while (generated < maxIterations) {
        const baseWeekStart = new Date(start);
        baseWeekStart.setDate(start.getDate() + weekOffset * 7 * interval);
        if (byDayIdx.length === 0) {
          if (weekOffset > 0) {
            const cursorStart = new Date(start);
            cursorStart.setDate(start.getDate() + weekOffset * 7 * interval);
            const cursorEnd = new Date(end);
            cursorEnd.setDate(end.getDate() + weekOffset * 7 * interval);
            if (until && cursorStart > until) break;
            instances.push(buildInstance(root, cursorStart, cursorEnd));
            generated++;
            if (!count && until && cursorStart > until) break;
            if (!count && !until && generated >= 30) break;
          }
        } else {
          for (const targetDay of byDayIdx) {
            if (generated >= maxIterations) break;
            const dayDiff = targetDay - rootDay;
            const cursorStart = new Date(baseWeekStart);
            cursorStart.setDate(baseWeekStart.getDate() + dayDiff);
            const cursorEnd = new Date(cursorStart);
            cursorEnd.setHours(end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds());
            if (cursorStart.getTime() === start.getTime()) continue;
            if (until && cursorStart > until) { generated = maxIterations; break; }
            instances.push(buildInstance(root, cursorStart, cursorEnd));
            generated++;
            if (!count && until && cursorStart > until) break;
            if (!count && !until && generated >= 30) break;
          }
        }
        weekOffset++;
      }
    }
  } catch (_) {
    return instances;
  }
  return instances;
}

export function buildRecurrenceSummary(rule: any, created: number, conflicts: number, errors: number) {
  if (!rule) return null;
  return { createdInstances: created, conflictInstances: conflicts, errorInstances: errors, requestedRule: rule };
}

function buildInstance(root: Task, s: Date, e: Date): Task {
  return {
    id: uuidv4(),
    name: root.name,
    description: root.description,
    startTime: s.toISOString(),
    endTime: e.toISOString(),
    dueDate: e.toISOString(),
    location: root.location,
    completed: false,
    pushedToMSTodo: false,
    parentTaskId: root.id
  } as Task;
}
