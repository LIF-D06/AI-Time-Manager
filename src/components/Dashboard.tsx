import { useState, useEffect } from 'react';
import { 
  startMicrosoftAuth, 
  removeToken, 
  updateEbridgePassword,
  getMicrosoftTodoStatus,
  getEbridgeStatus,
  type MicrosoftTodoStatus,
  type EbridgeStatus
} from '../services/api';
import '../styles/Dashboard.css';

interface DashboardProps {
  onLogout: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
  const [ebPassword, setEbPassword] = useState('');
  const [password, setPassword] = useState('');
  const [email] = useState(localStorage.getItem('user_email') || '');
  const [XJTLUaccount, setXJTLUaccount] = useState(localStorage.getItem('user_XJTLUaccount') || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [msTodoStatus, setMsTodoStatus] = useState<MicrosoftTodoStatus | null>(null);
  const [ebridgeStatus, setEbridgeStatus] = useState<EbridgeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');

  // 获取API状态
  useEffect(() => {
    const fetchStatuses = async () => {
      setStatusLoading(true);
      setStatusError('');
      
      try {
        // 并行获取两个API的状态
        const [msTodoResult, ebridgeResult] = await Promise.all([
          getMicrosoftTodoStatus(),
          getEbridgeStatus()
        ]);
        
        setMsTodoStatus(msTodoResult);
        setEbridgeStatus(ebridgeResult);
      } catch (err: any) {
        setStatusError(err.message || '获取接口状态失败');
        // console.error('Status fetch error:', err);
      } finally {
        setStatusLoading(false);
      }
    };

    fetchStatuses();
  }, []);

  const handleConnectMicrosoft = () => {
    startMicrosoftAuth();
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      await updateEbridgePassword({ email, XJTLUaccount, ebPassword, password });
      setMessage('密码更新成功，请等待处理。eb状态需要等待一会才能刷新。如果2分钟后仍未成功，请重试');
      setEbPassword('');
      setPassword('');
      
      // 更新密码后刷新Ebridge状态
      const newStatus = await getEbridgeStatus();
      setEbridgeStatus(newStatus);
    } catch (err: any) {
      setError(err.message || '密码更新失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    removeToken();
    localStorage.removeItem('user_email');
    onLogout();
  };

  const handleRefreshStatus = async () => {
    setStatusLoading(true);
    setStatusError('');
    
    try {
      const [msTodoResult, ebridgeResult] = await Promise.all([
        getMicrosoftTodoStatus(),
        getEbridgeStatus()
      ]);
      
      setMsTodoStatus(msTodoResult);
      setEbridgeStatus(ebridgeResult);
    } catch (err: any) {
      setStatusError(err.message || '刷新状态失败');
    } finally {
      setStatusLoading(false);
    }
  };

  const renderConnectionStatus = () => {
    if (statusLoading) {
      return <div className="status-loading">正在检查连接状态...</div>;
    }

    if (statusError) {
      return <div className="status-error">{statusError}</div>;
    }

    return (
      <div className="connection-status-section">
        <h3>连接状态</h3>
        <div className="status-container">
          <div className={`status-item ${msTodoStatus?.connected ? 'connected' : 'disconnected'}`}>
            <span className="status-label">Microsoft To Do:</span>
            <span className="status-value">
              {msTodoStatus?.connected ? '已连接' : '未连接'}
            </span>
            {msTodoStatus?.connected && <span className="status-badge connected">✓</span>}
          </div>
          
          <div className={`status-item ${ebridgeStatus?.connected ? 'connected' : 'disconnected'}`}>
            <span className="status-label">Ebridge:</span>
            <span className="status-value">
              {ebridgeStatus?.connected ? '已连接' : '未连接'}
            </span>
            {ebridgeStatus?.connected && <span className="status-badge connected">✓</span>}
          </div>
        </div>
        <button className="refresh-button" onClick={handleRefreshStatus}>
          刷新状态
        </button>
      </div>
    );
  };

  // 根据连接状态显示不同内容
  const renderContentBasedOnStatus = () => {
    // 如果两个服务都已连接
    if (msTodoStatus?.connected && ebridgeStatus?.connected) {
      return (
        <div className="fully-connected-content">
          <h2>🎉 所有服务已成功连接</h2>
          <p>您的Microsoft To Do和Ebridge账户都已成功连接，系统将自动同步您的任务和日程。</p>
          <div className="features-section">
            <h3>可用功能</h3>
            <ul>
              <li>任务自动同步到Microsoft To Do</li>
              <li>从Ebridge导入日程安排</li>
              <li>统一管理所有任务和日程</li>
            </ul>
          </div>
        </div>
      );
    }
    
    // 如果只有Microsoft To Do已连接
    if (msTodoStatus?.connected && !ebridgeStatus?.connected) {
      return (
        <div className="partial-connection-content">
          <h2>⚠️ 部分服务已连接</h2>
          <p>您的Microsoft To Do已连接，但Ebridge尚未连接或连接失败。</p>
          <p>请输入您的Ebridge密码以完成连接：</p>
        </div>
      );
    }
    
    // 如果只有Ebridge已连接
    if (!msTodoStatus?.connected && ebridgeStatus?.connected) {
      return (
        <div className="partial-connection-content">
          <h2>⚠️ 部分服务已连接</h2>
          <p>您的Ebridge已连接，但Microsoft To Do尚未连接或连接失败。</p>
          <p>请连接您的Microsoft账户以同步任务：</p>
        </div>
      );
    }
    
    // 如果两个服务都未连接
    return (
      <div className="no-connection-content">
        <h2>📱 请连接您的账户</h2>
        <p>要使用完整功能，请连接您的Microsoft和Ebridge账户。</p>
      </div>
    );
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>TimeManager</h1>
        <button className="logout-button" onClick={handleLogout}>
          退出登录
        </button>
      </header>

      <main className="dashboard-content">
        {/* 连接状态显示 */}
        {renderConnectionStatus()}
        
        {/* 基于状态的欢迎内容 */}
        <section className="welcome-section">
          {renderContentBasedOnStatus()}
        </section>

        {/* Microsoft连接按钮 - 只有在未连接时显示 */}
        {!msTodoStatus?.connected && (
          <section className="microsoft-section">
            <button 
              className="microsoft-button" 
              onClick={handleConnectMicrosoft}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.19 10.47l-1.9-1.9c-3.68-3.67-9.68-3.67-13.36 0-1.42 1.42-2.14 3.32-2.14 5.23 0 1.9.72 3.8 2.14 5.23 3.68 3.67 9.68 3.67 13.36 0l1.9-1.9c.75-.75.75-1.98 0-2.73s-1.98-.75-2.73 0l-1.9 1.9c-2.1 2.1-5.53 2.1-7.63 0-1.26-1.26-1.26-3.31 0-4.57 2.1-2.1 5.53-2.1 7.63 0l1.9 1.9c.75.75 1.98.75 2.73 0 .75-.75.75-1.98 0-2.73zM12 15.6v-11.2l5.6 5.6z"/>
              </svg>
              连接 Microsoft 账户
            </button>
          </section>
        )}

        {/* Ebridge密码更新表单 - 只有在未连接时显示 */}
        {!ebridgeStatus?.connected && (
          <section className="password-section">
            <h3>更新 Ebridge 密码</h3>
            {message && <div className="success-message">{message}</div>}
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={handleUpdatePassword}>
              <div className="form-group">
                <label htmlFor="XJTLUaccount">XJTLU 账号</label>
                <input
                  type="text"
                  id="XJTLUaccount"
                  value={XJTLUaccount}
                  onChange={(e) => setXJTLUaccount(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="ebPassword">Ebridge 密码</label>
                <input
                  type="password"
                  id="ebPassword"
                  value={ebPassword}
                  onChange={(e) => setEbPassword(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="password">本次操作敏感，需要您输入本平台密码</label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="update-button" disabled={loading}>
                {loading ? '更新中...' : '更新密码'}
              </button>
            </form>
          </section>
        )}
      </main>

      <footer className="dashboard-footer">
        <p>TimeManager © {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
};

export default Dashboard;