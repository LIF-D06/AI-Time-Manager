// API 服务文件，处理与后端的所有通信

const API_BASE_URL = '/api';

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
};;