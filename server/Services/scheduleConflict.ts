// 轻量级的时间冲突检测工具，独立于业务逻辑
// 在插入任务前用于检查与已有任务的时间段是否重叠

export interface TimeLikeTask {
  id: string;
  name?: string;
  startTime?: string | null;
  endTime?: string | null;
}

export interface ConflictCheckOptions {
  // 边界是否算冲突：当 A.end === B.start 时
  // false 表示不算冲突（默认），true 表示算冲突
  boundaryConflict?: boolean;
}

export class ScheduleConflictError extends Error {
  conflicts: TimeLikeTask[];
  candidate: TimeLikeTask;
  constructor(message: string, conflicts: TimeLikeTask[], candidate: TimeLikeTask) {
    super(message);
    this.name = 'ScheduleConflictError';
    this.conflicts = conflicts;
    this.candidate = candidate;
  }
}

function parseDateSafe(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date, boundaryConflict: boolean): boolean {
  if (boundaryConflict) {
    // 闭区间相交：[aStart, aEnd] 与 [bStart, bEnd]
    return aStart <= bEnd && aEnd >= bStart;
  }
  // 半开区间相交：[aStart, aEnd) 与 [bStart, bEnd)
  return aStart < bEnd && aEnd > bStart;
}

export function findConflictingTasks(
  existing: TimeLikeTask[],
  candidate: TimeLikeTask,
  options?: ConflictCheckOptions
): TimeLikeTask[] {
  const boundaryConflict = options?.boundaryConflict ?? false;

  const cStart = parseDateSafe(candidate.startTime || undefined);
  const cEnd = parseDateSafe(candidate.endTime || undefined);

  // 若候选任务缺少有效时间，则不做冲突判定
  if (!cStart || !cEnd || cEnd <= cStart) return [];

  const conflicts: TimeLikeTask[] = [];
  for (const t of existing) {
    if (!t || t.id === candidate.id) continue;
    const tStart = parseDateSafe(t.startTime || undefined);
    const tEnd = parseDateSafe(t.endTime || undefined);
    if (!tStart || !tEnd || tEnd <= tStart) continue;

    if (overlaps(cStart, cEnd, tStart, tEnd, boundaryConflict)) {
      conflicts.push(t);
    }
  }
  return conflicts;
}

export function assertNoConflict(
  existing: TimeLikeTask[],
  candidate: TimeLikeTask,
  options?: ConflictCheckOptions
): void {
  const conflicts = findConflictingTasks(existing, candidate, options);
  if (conflicts.length > 0) {
    throw new ScheduleConflictError('Schedule time conflict detected', conflicts, candidate);
  }
}
