// API 服务文件，处理与后端的所有通信

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export const authEvents = new EventTarget();

const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await fetch(input, init);
  if (response.status === 403) {
    authEvents.dispatchEvent(new Event('unauthorized'));
  }
  return response;
};

// 存储JWT令牌
export const setToken = (token: string): void => {
  localStorage.setItem('auth_token', token);
};

export const getToken = (): string | null => {
  return localStorage.getItem('auth_token');
};

export const removeToken = (): void => {
  localStorage.removeItem('auth_token');
};

export const isAuthenticated = (): boolean => {
  return !!getToken();
};

// 注册用户
export interface RegisterData {
  email: string;
  password: string;
  name: string;
}

export const register = async (data: RegisterData): Promise<{ token: string }> => {
  const response = await customFetch(`${API_BASE_URL}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '注册失败');
  }

  const result = await response.json();
  // 保存用户邮箱
  localStorage.setItem('user_email', data.email);
  return result;
};

// 登录用户
export interface LoginData {
  email: string;
  password: string;
}

export const login = async (data: LoginData): Promise<{ token: string }> => {
  const response = await customFetch(`${API_BASE_URL}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '登录失败');
  }

  const result = await response.json();
  // 保存用户邮箱
  localStorage.setItem('user_email', data.email);
  return result;
};

// 启动Microsoft OAuth流程
export const startMicrosoftAuth = (): void => {
  const token = getToken();
  if (token) {
    window.location.href = `${API_BASE_URL}/auth?jwt=${encodeURIComponent(token)}`;
  } else {
    window.location.href = `${API_BASE_URL}/auth`;
  }
};

// 更新Ebridge密码
export interface UpdatePasswordData {
  email: string;
  XJTLUaccount: string;
  ebPassword: string;
  password: string;
}

export const updateEbridgePassword = async (data: UpdatePasswordData): Promise<void> => {
  const response = await customFetch(`${API_BASE_URL}/updateEbridgePassword`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '密码更新失败');
  }
}

// 查询Microsoft Todo状态接口
export interface MicrosoftTodoStatus {
  connected: boolean;
  binded: boolean;
  tokenAvailable: boolean;
  lastChecked: string;
}

export const getMicrosoftTodoStatus = async (): Promise<MicrosoftTodoStatus> => {
  const response = await customFetch(`${API_BASE_URL}/api/status/microsoft-todo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '获取Microsoft Todo状态失败');
  }

  return response.json();
};

// 查询Ebridge状态接口
export interface EbridgeStatus {
  connected: boolean;
  binded: boolean;
  passwordAvailable: boolean;
  emsClientAvailable: boolean;
  lastChecked: string;
}

export const getEbridgeStatus = async (): Promise<EbridgeStatus> => {
  const response = await customFetch(`${API_BASE_URL}/api/status/ebridge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '获取Ebridge状态失败');
  }

  return response.json();
};

// 获取用户日志
export interface LogEntry {
  id: string;
  time: string;
  type: string;
  message: string;
  payload?: any;
}

export interface LogsResponse {
  logs: LogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export const getLogs = async (params?: { limit?: number; offset?: number; type?: string; since?: string; until?: string }): Promise<LogsResponse> => {
  const queryParams = new URLSearchParams();
  if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
  if (params?.offset !== undefined) queryParams.append('offset', params.offset.toString());
  if (params?.type) queryParams.append('type', params.type);
  if (params?.since) queryParams.append('since', params.since);
  if (params?.until) queryParams.append('until', params.until);

  const response = await customFetch(`${API_BASE_URL}/api/logs?${queryParams.toString()}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '获取日志失败');
  }

  return response.json();
};

// 获取任务列表
export type ScheduleType =
  | 'single'
  | 'recurring_daily'
  | 'recurring_weekly'
  | 'recurring_weekly_by_week_number'
  | 'recurring_daily_on_days';

export interface Task {
  id: string;
  name: string;
  description: string;
  startTime: string;
  endTime: string;
  dueDate: string;
  location?: string;
  completed: boolean;
  pushedToMSTodo: boolean;
  recurrenceRule?: string;
  parentTaskId?: string;
  importance?: 'high' | 'normal' | 'low';
  scheduleType?: ScheduleType;
}

export interface TasksResponse {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
  sortBy: string;
  order: 'asc' | 'desc';
}

export interface MicrosoftTodoStatus {
  connected: boolean;
}

export interface EbridgeStatus {
  connected: boolean;
}

export class ScheduleConflictError extends Error {
  conflicts: Task[];
  constructor(message: string, conflicts: Task[]) {
    super(message);
    this.name = 'ScheduleConflictError';
    this.conflicts = conflicts;
  }
}

export interface ConflictWarning {
  message: string;
  conflicts: Task[];
  instanceConflicts?: any[];
}

export interface CreateTaskResponse {
  task: Task;
  recurrenceSummary?: any;
  conflictWarning?: ConflictWarning;
}

export const createTask = async (taskData: Omit<Task, 'id' | 'completed'>): Promise<CreateTaskResponse> => {
  const token = getToken();
  if (!token) throw new Error('用户未登录');

  const response = await customFetch('/api/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(taskData),
  });

  if (!response.ok) {
    const errorData = await response.json();
    if (response.status === 409 && errorData.conflicts) {
      throw new ScheduleConflictError(errorData.error || '日程冲突', errorData.conflicts);
    }
    throw new Error(errorData.error || '创建任务失败');
  }

  return await response.json();
};

export const updateTask = async (taskId: string, taskData: Partial<Omit<Task, 'id'>>): Promise<Task & { conflictWarning?: ConflictWarning }> => {
  const token = getToken();
  if (!token) throw new Error('用户未登录');

  const response = await customFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(taskData),
  });

  if (!response.ok) {
    const errorData = await response.json();
    if (response.status === 409 && errorData.conflicts) {
      throw new ScheduleConflictError(errorData.error || '日程冲突', errorData.conflicts);
    }
    throw new Error(errorData.error || '更新任务失败');
  }

  return await response.json();
};

export interface BatchTaskResult {
  input: any;
  status: 'created' | 'conflict' | 'error';
  task?: Task;
  conflictList?: Task[];
  errorMessage?: string;
}

export interface BatchTasksResponse {
  results: BatchTaskResult[];
  summary: {
    total: number;
    created: number;
    conflicts: number;
    errors: number;
  };
}

export const createTasksBatch = async (tasks: Omit<Task, 'id' | 'completed'>[], boundaryConflict: boolean = false): Promise<BatchTasksResponse> => {
  const token = getToken();
  if (!token) throw new Error('用户未登录');

  const response = await customFetch('/api/tasks/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ tasks, boundaryConflict }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || '批量创建任务失败');
  }

  return await response.json();
};

export const getTasks = async (params: { start?: string; end?: string; limit?: number; q?: string; completed?: boolean; offset?: number; sortBy?: string; order?: 'asc' | 'desc' }): Promise<TasksResponse> => {
  const token = getToken();
  if (!token) throw new Error('用户未登录');

  const queryParams = new URLSearchParams();
  if (params.start) queryParams.append('start', params.start);
  if (params.end) queryParams.append('end', params.end);
  if (params.limit) queryParams.append('limit', params.limit.toString());
  if (params.q) queryParams.append('q', params.q);
  if (params.completed !== undefined) queryParams.append('completed', params.completed.toString());
  if (params.offset) queryParams.append('offset', params.offset.toString());
  if (params.sortBy) queryParams.append('sortBy', params.sortBy);
  if (params.order) queryParams.append('order', params.order);

  const response = await customFetch(`/api/tasks?${queryParams.toString()}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || '获取任务失败');
  }

  return await response.json();
};

export const deleteTask = async (taskId: string, cascade: boolean = false): Promise<void> => {
  const token = getToken();
  if (!token) throw new Error('用户未登录');

  const url = `/api/tasks/${encodeURIComponent(taskId)}${cascade ? '?cascade=true' : ''}`;

  const response = await customFetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || '删除任务失败');
  }
};

export interface SyncTimetableResponse {
  message: string;
  added: number;
  errors: number;
}

export const syncTimetable = async (): Promise<SyncTimetableResponse> => {
  const response = await customFetch(`${API_BASE_URL}/api/sync/timetable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '同步课表失败');
  }

  return response.json();
};

export interface DeleteTimetableResponse {
  message: string;
  count: number;
}

export const deleteTimetableTasks = async (): Promise<DeleteTimetableResponse> => {
  const response = await customFetch(`${API_BASE_URL}/api/sync/timetable`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '删除课表日程失败');
  }

  return response.json();
};

// 获取当前周信息（含全局与用户偏移）
export interface WeekInfoResponse {
  rawWeekNumber: number;
  globalWeekOffset: number;
  userWeekOffset: number;
  effectiveWeek: number;
}

export const getWeekInfo = async (): Promise<WeekInfoResponse> => {
  const response = await customFetch(`/api/settings/week`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '获取周信息失败');
  }

  return response.json();
};

// 设置用户级周偏移或通过提供 currentWeek 来设置当前周
export const setUserWeek = async (data: { currentWeek?: number; userWeekOffset?: number }): Promise<WeekInfoResponse> => {
  const response = await customFetch(`/api/settings/week`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '设置周信息失败');
  }

  return response.json();
};