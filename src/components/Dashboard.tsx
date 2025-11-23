import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  startMicrosoftAuth, 
  removeToken, 
  getToken,
  updateEbridgePassword,
  getMicrosoftTodoStatus,
  getEbridgeStatus,
  type MicrosoftTodoStatus,
  type EbridgeStatus
} from '../services/api';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import AllSchedule from './Schedule/AllSchedule';
import TodaySchedule from './Schedule/TodaySchedule';
import LogViewer from './Logs/LogViewer';
import AIChat from './AIChat/AIChat';
import { LayoutDashboard, Calendar, ListTodo, FileText, LogOut, MessageSquare } from 'lucide-react';
import '../styles/Dashboard.css';

interface DashboardProps {
  onLogout: () => void;
  view?: string;
}

const Dashboard: React.FC<DashboardProps> = ({ onLogout, view }) => {
  const navigate = useNavigate();
  const location = useLocation();
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
  const [tokenCopied, setTokenCopied] = useState(false);

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
    navigate('/login');
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

  const handleCopyToken = () => {
    const token = getToken();
    if (token) {
      navigator.clipboard.writeText(token).then(() => {
        setTokenCopied(true);
        setTimeout(() => setTokenCopied(false), 2000);
      });
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
      <Card className="connection-status-section">
        <CardHeader>
          <CardTitle>连接状态</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="status-container">
            <div className={`status-item ${msTodoStatus?.connected ? 'connected' : 'disconnected'}`}>
              <span className="status-label">Microsoft To Do:</span>
              <span className="status-value">
                {msTodoStatus?.connected ? '已连接' : '未连接'}
              </span>
              {msTodoStatus?.connected && <Badge variant="success">✓</Badge>}
            </div>
            
            <div className={`status-item ${ebridgeStatus?.connected ? 'connected' : 'disconnected'}`}>
              <span className="status-label">Ebridge:</span>
              <span className="status-value">
                {ebridgeStatus?.connected ? '已连接' : '未连接'}
              </span>
              {ebridgeStatus?.connected && <Badge variant="success">✓</Badge>}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
            <Button onClick={handleRefreshStatus}>
              刷新状态
            </Button>
          </div>
          
          <div className="mcp-token-section">
            <h4>MCP 鉴权 Token</h4>
            <p>用于配置 MCP 客户端访问您的数据</p>
            <Button 
              variant={tokenCopied ? 'success' : 'secondary'}
              onClick={handleCopyToken}
            >
              {tokenCopied ? '已复制到剪贴板!' : '复制 Access Token'}
            </Button>
          </div>
        </CardContent>
      </Card>
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

  const renderMainContent = () => {
    if (view === 'all-schedule') return <AllSchedule />;
    if (view === 'today-schedule') return <TodaySchedule />;
    if (view === 'logs') return <LogViewer />;
    if (view === 'chat') return <AIChat />;
    
    // Default Dashboard View
    return (
      <>
        {/* 连接状态显示 */}
        {renderConnectionStatus()}
        
        {/* 基于状态的欢迎内容 */}
        <section className="welcome-section">
          {renderContentBasedOnStatus()}
        </section>

        {/* Microsoft连接按钮 - 只有在未连接时显示 */}
        {!msTodoStatus?.connected && (
          <section className="microsoft-section">
            <Button 
              variant="primary"
              size="lg"
              onClick={handleConnectMicrosoft}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
                <path d="M19.19 10.47l-1.9-1.9c-3.68-3.67-9.68-3.67-13.36 0-1.42 1.42-2.14 3.32-2.14 5.23 0 1.9.72 3.8 2.14 5.23 3.68 3.67 9.68 3.67 13.36 0l1.9-1.9c.75-.75.75-1.98 0-2.73s-1.98-.75-2.73 0l-1.9 1.9c-2.1 2.1-5.53 2.1-7.63 0-1.26-1.26-1.26-3.31 0-4.57 2.1-2.1 5.53-2.1 7.63 0l1.9 1.9c.75.75 1.98.75 2.73 0 .75-.75.75-1.98 0-2.73zM12 15.6v-11.2l5.6 5.6z"/>
              </svg>
              连接 Microsoft 账户
            </Button>
          </section>
        )}

        {/* Ebridge密码更新表单 - 只有在未连接时显示 */}
        {!ebridgeStatus?.connected && (
          <Card className="password-section">
            <CardHeader>
              <CardTitle style={{ justifyContent: 'center' }}>更新 Ebridge 密码</CardTitle>
            </CardHeader>
            <CardContent>
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
                <Button type="submit" disabled={loading} style={{ width: '100%' }}>
                  {loading ? '更新中...' : '更新密码'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </>
    );
  };

  return (
    <div className="dashboard-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>TimeManager</h1>
        </div>
        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${!view || view === 'dashboard' ? 'active' : ''}`}
            onClick={() => navigate('/dashboard')}
          >
            <LayoutDashboard size={20} /> 仪表盘
          </button>
          <button 
            className={`nav-item ${view === 'today-schedule' ? 'active' : ''}`}
            onClick={() => navigate('/schedule/today')}
          >
            <ListTodo size={20} /> 今日日程
          </button>
          <button 
            className={`nav-item ${view === 'all-schedule' ? 'active' : ''}`}
            onClick={() => navigate('/schedule/all')}
          >
            <Calendar size={20} /> 全部日程
          </button>
          <button 
            className={`nav-item ${view === 'chat' ? 'active' : ''}`}
            onClick={() => navigate('/chat')}
          >
            <MessageSquare size={20} /> AI 助手
          </button>
          <button 
            className={`nav-item ${view === 'logs' ? 'active' : ''}`}
            onClick={() => navigate('/logs')}
          >
            <FileText size={20} /> 系统日志
          </button>
        </nav>
import { Button } from './ui/Button';

// ...existing code...

        <div className="sidebar-footer">
          <Button 
            variant="danger" 
            className="logout-button-sidebar" 
            onClick={handleLogout}
            style={{ width: '100%', justifyContent: 'flex-start' }}
          >
            <LogOut size={18} style={{ marginRight: '8px' }} /> 退出登录
          </Button>
        </div>
      </aside>

      <main className="main-content">
        {renderMainContent()}
      </main>
    </div>
  );
};

export default Dashboard;