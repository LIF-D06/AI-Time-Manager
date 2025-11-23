import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import AllSchedule from './Schedule/AllSchedule';
import TodaySchedule from './Schedule/TodaySchedule';
import SearchTasks from './Schedule/SearchTasks';
import LogViewer from './Logs/LogViewer';
import AIChat from './AIChat/AIChat';
import { LayoutDashboard, Calendar, ListTodo, FileText, LogOut, MessageSquare, PanelLeftClose, PanelLeftOpen, Menu, X, Search } from 'lucide-react';
import { ToggleButton } from './ui/ToggleButton';
import '../styles/Dashboard.css';

interface DashboardProps {
  onLogout: () => void;
  view?: string;
}

const Dashboard: React.FC<DashboardProps> = ({ onLogout, view }) => {
  const navigate = useNavigate();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(window.innerWidth < 1024);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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
  const [showUnboundModal, setShowUnboundModal] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setIsMobileMenuOpen(false);
        setIsSidebarCollapsed(window.innerWidth < 1024);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

        // 如果有未绑定的账号，显示弹窗
        if (!msTodoResult.connected || !ebridgeResult.connected) {
          setShowUnboundModal(true);
        }
      } catch (err: any) {
        setStatusError(err.message || '获取接口状态失败');
        // console.error('Status fetch error:', err);
      } finally {
        setStatusLoading(false);
      }
    };

    fetchStatuses();
  }, []);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    setIsMobileMenuOpen(false);
  };

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
              variant={tokenCopied ? 'primary' : 'secondary'}
              onClick={handleCopyToken}
            >
              {tokenCopied ? '已复制到剪贴板!' : '复制 Access Token'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderMainContent = () => {
    if (view === 'all-schedule') return <AllSchedule />;
    if (view === 'today-schedule') return <TodaySchedule />;
    if (view === 'search-schedule') return <SearchTasks />;
    if (view === 'logs') return <LogViewer />;
    if (view === 'chat') return <AIChat />;
    
    // Default Dashboard View
    return (
      <div className="settings-page">
        <Card>
          <CardHeader>
            <CardTitle>账号信息</CardTitle>
          </CardHeader>
          <CardContent className="account-info">
            <div className="info-item">
              <span className="info-label">登录邮箱:</span>
              <span className="info-value">{email}</span>
            </div>
            <div className="info-item">
              <span className="info-label">XJTLU 账号:</span>
              <span className="info-value">{XJTLUaccount || '未设置'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">退出登录:</span>
              <Button variant="danger" onClick={handleLogout}>
                <LogOut size={18} /> 退出登录
              </Button>
            </div>
          </CardContent>
        </Card>

        {renderConnectionStatus()}

        {/* Microsoft连接按钮 - 只有在未连接时显示 */}
        {!msTodoStatus?.connected && (
          <section className="connection-action">
            <Card>
              <CardHeader>
                <CardTitle>连接 Microsoft 账户</CardTitle>
              </CardHeader>
              <CardContent>
                <p>连接您的 Microsoft 账户以同步任务到 To Do 列表。</p>
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
              </CardContent>
            </Card>
          </section>
        )}

        {/* Ebridge密码更新表单 - 只有在未连接时显示 */}
        {!ebridgeStatus?.connected && (
          <section className="connection-action">
            <Card>
              <CardHeader>
                <CardTitle>更新 Ebridge 密码</CardTitle>
              </CardHeader>
              <CardContent>
                {message && <div className="success-message">{message}</div>}
                {error && <div className="error-message">{error}</div>}
                <form onSubmit={handleUpdatePassword}>
                  <Input
                    label="XJTLU 账号"
                    type="text"
                    id="XJTLUaccount"
                    value={XJTLUaccount}
                    onChange={(e) => setXJTLUaccount(e.target.value)}
                    required
                  />
                  <Input
                    label="Ebridge 密码"
                    type="password"
                    id="ebPassword"
                    value={ebPassword}
                    onChange={(e) => setEbPassword(e.target.value)}
                    required
                  />
                  <Input
                    label="平台登录密码"
                    type="password"
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <Button type="submit" disabled={loading} style={{ width: '100%' }}>
                    {loading ? '更新中...' : '更新密码'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    );
  };

  const renderNavItems = () => (
    <>
      <button 
        className={`nav-item ${view === 'today-schedule' ? 'active' : ''}`}
        onClick={() => handleNavClick('/schedule/today')}
      >
        <ListTodo size={20} /> <span className="nav-text">今日日程</span>
      </button>
      <button 
        className={`nav-item ${view === 'all-schedule' ? 'active' : ''}`}
        onClick={() => handleNavClick('/schedule/all')}
      >
        <Calendar size={20} /> <span className="nav-text">全部日程</span>
      </button>
      <button 
        className={`nav-item ${view === 'search-schedule' ? 'active' : ''}`}
        onClick={() => handleNavClick('/schedule/search')}
      >
        <Search size={20} /> <span className="nav-text">搜索任务</span>
      </button>
      <button 
        className={`nav-item ${view === 'chat' ? 'active' : ''}`}
        onClick={() => handleNavClick('/chat')}
      >
        <MessageSquare size={20} /> <span className="nav-text">AI 助手</span>
      </button>
      <button 
        className={`nav-item ${view === 'logs' ? 'active' : ''}`}
        onClick={() => handleNavClick('/logs')}
      >
        <FileText size={20} /> <span className="nav-text">系统日志</span>
      </button>
    </>
  );

  return (
    <div className={`dashboard-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''} ${isMobile ? 'mobile-layout' : ''}`}>
      {isMobile ? (
        <header className={`mobile-header ${isMobileMenuOpen ? 'open' : ''}`}>
          <div className="mobile-header-top">
            <h1 className="logo-text">时间锚</h1>
            <button className="mobile-menu-toggle" onClick={toggleMobileMenu}>
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
          <nav className={`mobile-nav ${isMobileMenuOpen ? 'open' : ''}`}>
            {renderNavItems()}
            <div className="mobile-nav-footer">
              <button 
                className={`nav-item ${!view || view === 'dashboard' ? 'active' : ''}`}
                onClick={() => handleNavClick('/dashboard')}
              >
                <LayoutDashboard size={20} /> <span className="nav-text">设置</span>
              </button>
            </div>
          </nav>
        </header>
      ) : (
        <aside className="sidebar">
          <div className="sidebar-header">
            <h1 className="logo-text">时间锚</h1>
            <ToggleButton
              isToggled={isSidebarCollapsed}
              onToggle={toggleSidebar}
              toggledIcon={<PanelLeftOpen size={20} />}
              untoggledIcon={<PanelLeftClose size={20} />}
              toggledClassName=""
            />
          </div>
          <nav className="sidebar-nav">
            {renderNavItems()}
          </nav>
          <div className="sidebar-footer">
            <button 
              className={`nav-item ${!view || view === 'dashboard' ? 'active' : ''}`}
              onClick={() => handleNavClick('/dashboard')}
            >
              <LayoutDashboard size={20} /> <span className="nav-text">设置</span>
            </button>
          </div>
        </aside>
      )}

      <main className="main-content">
        {renderMainContent()}
        
        <Modal
          isOpen={showUnboundModal}
          onClose={() => setShowUnboundModal(false)}
          title="账号绑定提醒"
          footer={
            <Button onClick={() => setShowUnboundModal(false)}>
              我知道了
            </Button>
          }
        >
          <p>检测到您有尚未绑定的账号：</p>
          <ul style={{ paddingLeft: '20px', margin: '10px 0' }}>
            {!msTodoStatus?.connected && <li>Microsoft To Do 未连接</li>}
            {!ebridgeStatus?.connected && <li>Ebridge 未连接</li>}
          </ul>
          <p>为了确保功能正常使用，请尽快完成绑定。</p>
        </Modal>
      </main>
    </div>
  );
};

export default Dashboard;