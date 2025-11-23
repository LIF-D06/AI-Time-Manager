// API 服务文件，处理与后端的所有通信

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

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
  const response = await fetch(`${API_BASE_URL}/register`, {
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
  const response = await fetch(`${API_BASE_URL}/login`, {
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
  const response = await fetch(`${API_BASE_URL}/updateEbridgePassword`, {
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
  const response = await fetch(`${API_BASE_URL}/api/status/microsoft-todo`, {
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
  const response = await fetch(`${API_BASE_URL}/api/status/ebridge`, {
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
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.offset) queryParams.append('offset', params.offset.toString());
  if (params?.type) queryParams.append('type', params.type);
  if (params?.since) queryParams.append('since', params.since);
  if (params?.until) queryParams.append('until', params.until);

  const response = await fetch(`${API_BASE_URL}/api/logs?${queryParams.toString()}`, {
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
}

export interface TasksResponse {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
}

export const getTasks = async (params?: { start?: string; end?: string; limit?: number; offset?: number; completed?: boolean }): Promise<TasksResponse> => {
  const queryParams = new URLSearchParams();
  if (params?.start) queryParams.append('start', params.start);
  if (params?.end) queryParams.append('end', params.end);
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.offset) queryParams.append('offset', params.offset.toString());
  if (params?.completed !== undefined) queryParams.append('completed', params.completed.toString());

  const response = await fetch(`${API_BASE_URL}/api/tasks?${queryParams.toString()}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '获取任务失败');
  }

  return response.json();
};