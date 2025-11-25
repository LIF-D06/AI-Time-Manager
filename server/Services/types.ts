import { AttachmentCollection, EmailMessage } from "ews-javascript-api";

// 课程时间表API响应类型
export interface TimetableActivity {
  department: string | null;
  weekPattern: string;
  scheduledDay: string;
  startTime: string;
  endTime: string;
  activityType: string;
  staff: string | null;
  location: string | null;
  plannedSize: number;
  moduleId: string;
  templateId: string;
  sectionId: string | null;
  isLocked: boolean;
  realSize: number;
  identity: string;
  name: string;
}

// 通用类型定义
export interface IEmail {
  id: string;
  subject: string;
  from?: {
    name: string;
    address: string;
  };
  receivedAt: string;
  isRead: boolean;
  body?: string;
  hasAttachments: boolean;
  attachments?: AttachmentCollection;
}

export interface IEvent {
  id?: string;
  subject: string;
  start: string;
  end: string;
  location?: string;
  body?: string;
  attendees?: string[];
  importance?: 'high' | 'normal' | 'low';
  isReminderOn?: boolean;
}

export interface CourseSchedule {
  courseName: string;
  courseCode: string;
  instructor: string;
  location: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  semester: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ExchangeConfig {
  MStoken?: string;
  exchangeUrl: string;
  username: string;
  password: string;
  domain?: string;
  openaiApiKey?: string;
  openaiModel?: string;
}

// Recurrence rule shape used by recurrence generator and APIs
export type RecurrenceFreq = 'daily' | 'weekly' | 'weeklyByWeekNumber' | 'dailyOnDays';

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval?: number;
  count?: number;
  until?: string; // ISO date string
  byDay?: string[]; // e.g. ['Mon','Wed'] for weekly
  weeks?: number[]; // ISO week numbers for weeklyByWeekNumber
  days?: number[]; // weekday indices 0-6 for dailyOnDays
}

export type ScheduleType =
  | 'single'
  | 'recurring_daily'
  | 'recurring_weekly'
  | 'recurring_weekly_by_week_number'
  | 'recurring_daily_on_days';

export const scheduleTypeValues = [
  'single',
  'recurring_daily',
  'recurring_weekly',
  'recurring_weekly_by_week_number',
  'recurring_daily_on_days'
] as const satisfies readonly ScheduleType[];

const recurrenceFreqValues: readonly RecurrenceRule['freq'][] = [
  'daily',
  'weekly',
  'weeklyByWeekNumber',
  'dailyOnDays'
];

const scheduleTypeByFreq: Record<RecurrenceRule['freq'], ScheduleType> = {
  daily: 'recurring_daily',
  weekly: 'recurring_weekly',
  weeklyByWeekNumber: 'recurring_weekly_by_week_number',
  dailyOnDays: 'recurring_daily_on_days'
};

export function isScheduleType(value: unknown): value is ScheduleType {
  return typeof value === 'string' && (scheduleTypeValues as readonly string[]).includes(value);
}

export function parseRecurrenceRuleInput(rule: unknown): RecurrenceRule | undefined {
  if (!rule) return undefined;
  let candidate: unknown = rule;
  if (typeof rule === 'string') {
    try {
      candidate = JSON.parse(rule);
    } catch {
      return undefined;
    }
  }
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const maybeRule = candidate as Partial<RecurrenceRule>;
  if (!maybeRule.freq || !recurrenceFreqValues.includes(maybeRule.freq)) return undefined;
  return maybeRule as RecurrenceRule;
}

export function resolveScheduleType(options: {
  explicit?: unknown;
  recurrence?: unknown;
  fallback?: ScheduleType;
}): { scheduleType: ScheduleType; parsedRecurrence?: RecurrenceRule } {
  const { explicit, recurrence, fallback = 'single' } = options;
  const parsedRecurrence = parseRecurrenceRuleInput(recurrence);
  if (recurrence !== undefined && recurrence !== null && !parsedRecurrence) {
    throw new Error('Invalid recurrenceRule value');
  }
  if (explicit !== undefined && explicit !== null) {
    if (!isScheduleType(explicit)) {
      throw new Error('Invalid scheduleType value');
    }
    return { scheduleType: explicit, parsedRecurrence };
  }
  if (parsedRecurrence) {
    const mapped = scheduleTypeByFreq[parsedRecurrence.freq];
    if (mapped) {
      return { scheduleType: mapped, parsedRecurrence };
    }
  }
  return { scheduleType: fallback, parsedRecurrence };
}

