// 统一 API 类型定义
// 注意：这些类型仅用于编译期约束，不参与运行时校验

import { Task } from '../index';

export interface StatusMicrosoftTodoResponse {
  connected: boolean;
  binded: boolean;
  tokenAvailable: boolean;
  lastChecked: string;
}

export interface StatusEbridgeResponse {
  connected: boolean;
  binded: boolean;
  passwordAvailable: boolean;
  emsClientAvailable: boolean;
  timetableUrl: string | null;
  lastChecked: string;
}

export interface GenericErrorResponse {
  error: string;
  message?: string;
}

export interface TaskCreateRequest {
  name: string;
  description?: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  dueDate?: string;  // ISO
  location?: string;
  boundaryConflict?: boolean; // 请求级覆盖用户级边界模式
  recurrenceRule?: {
    freq: 'daily' | 'weekly';
    interval?: number; // 默认 1
    count?: number; // 生成次数（与 until 二选一优先 count）
    until?: string; // ISO 截止日期（不含当天超过则停止）
    byDay?: string[]; // 仅 weekly 使用: ['Mon','Wed','Fri'] 等
  };
}

export interface TaskCreateResponse {
  task: Task;
}

export interface TaskConflictDetail {
  id: string;
  name?: string;
  startTime?: string | null;
  endTime?: string | null;
}

export interface TaskConflictResponse {
  error: 'conflict';
  message: string;
  candidate: TaskConflictDetail;
  conflicts: TaskConflictDetail[];
}

export interface ConflictPreCheckRequest {
  startTime: string; // ISO
  endTime: string;   // ISO
  boundaryConflict?: boolean;
}

export interface ConflictPreCheckResponse {
  conflicts: TaskConflictDetail[];
}

export interface BatchTaskItemInput extends TaskCreateRequest {}

export interface BatchTaskCreateRequest {
  tasks: BatchTaskItemInput[];
  boundaryConflict?: boolean; // 批量请求统一覆盖（单项内存在则以单项为准）
}

export interface BatchTaskCreateItemResult {
  input: BatchTaskItemInput;
  status: 'created' | 'conflict' | 'error';
  task?: Task;
  conflictList?: TaskConflictDetail[];
  errorMessage?: string;
}

export interface BatchTaskCreateResponse {
  results: BatchTaskCreateItemResult[];
  summary: {
    total: number;
    created: number;
    conflicts: number;
    errors: number;
  };
}

export interface ConflictModeUpdateRequest {
  boundaryConflictInclusive: boolean; // true: 端点相接算冲突
}

export interface ConflictModeUpdateResponse {
  boundaryConflictInclusive: boolean;
  updatedAt: string;
}

// ---- 新增：任务更新 / 删除 / 列表 ----

export interface TaskUpdateRequest {
  name?: string;
  description?: string;
  startTime?: string; // ISO
  endTime?: string;   // ISO
  dueDate?: string;   // ISO
  location?: string;
  completed?: boolean;
  boundaryConflict?: boolean; // 请求级覆盖
  recurrenceRule?: {
    freq: 'daily' | 'weekly';
    interval?: number;
    count?: number;
    until?: string;
    byDay?: string[];
  } | null; // null 表示移除重复规则
}

// 重复任务生成统计
export interface RecurrenceSummary {
  createdInstances: number;
  conflictInstances: number;
  errorInstances: number;
  requestedRule?: any;
}


export interface TaskUpdateResponse {
  task: Task;
}

export interface TaskDeleteResponse {
  id: string;
  deleted: boolean;
}

export interface TaskListQueryParams {
  start?: string; // ISO (过滤区间开始)
  end?: string;   // ISO (过滤区间结束)
  limit?: number;
  offset?: number;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
}
