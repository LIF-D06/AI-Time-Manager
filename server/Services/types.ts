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

