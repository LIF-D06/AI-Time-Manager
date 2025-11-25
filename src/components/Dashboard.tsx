import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  startMicrosoftAuth, 
  removeToken, 
  getToken,
  updateEbridgePassword,
  getMicrosoftTodoStatus,
  getEbridgeStatus,
  syncTimetable,
  deleteTimetableTasks,
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
import { useWeek } from '../context/WeekContext';
import { LayoutDashboard, Calendar, ListTodo, FileText, LogOut, MessageSquare, PanelLeftClose, PanelLeftOpen, Menu, X, Search, RefreshCw, Copy, Check, Trash2, Download, Link } from 'lucide-react';
import { ToggleButton } from './ui/ToggleButton';
import '../styles/Dashboard.css';

interface DashboardProps {
  onLogout: () => void;
  view?: string;
}

const Dashboard: React.FC<DashboardProps> = ({ onLogout, view }) => {
  const navigate = useNavigate();
  
  // Get breakpoint from CSS variables
  const getMobileBreakpoint = () => {
    const root = document.documentElement;
    const breakpoint = getComputedStyle(root).getPropertyValue('--breakpoint-mobile').trim();
    return parseInt(breakpoint) || 768;
  };
  
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const mobileBreakpoint = getMobileBreakpoint();
    const isMobileView = window.innerWidth < mobileBreakpoint;
    return !isMobileView && window.innerWidth < 1024;
  });
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < getMobileBreakpoint());
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
  const [syncLoading, setSyncLoading] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showEbridgeConnectModal, setShowEbridgeConnectModal] = useState(false);
  const [resultModalData, setResultModalData] = useState({ title: '', message: '', isError: false });
  const { weekInfo, setCurrentWeek } = useWeek();
  const [desiredWeek, setDesiredWeek] = useState<number | ''>('');
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekError, setWeekError] = useState('');
  const [showWeekModal, setShowWeekModal] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const mobileBreakpoint = getMobileBreakpoint();
      const mobile = window.innerWidth < mobileBreakpoint;
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
    // Week info now provided by WeekContext at startup
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
      setShowEbridgeConnectModal(false);
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

  const handleSyncTimetable = async () => {
    setSyncLoading(true);
    try {
      const result = await syncTimetable();
      setResultModalData({
        title: '同步成功',
        message: `课表同步成功！新增: ${result.added}, 错误: ${result.errors}`,
        isError: false
      });
      setShowResultModal(true);
    } catch (err: any) {
      setResultModalData({
        title: '同步失败',
        message: err.message || '课表同步失败',
        isError: true
      });
      setShowResultModal(true);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleDeleteTimetable = () => {
    setShowDeleteConfirmModal(true);
  };

  const executeDeleteTimetable = async () => {
    setSyncLoading(true);
    setShowDeleteConfirmModal(false);
    
    try {
      const result = await deleteTimetableTasks();
      setResultModalData({
        title: '操作成功',
        message: result.message,
        isError: false
      });
      setShowResultModal(true);
    } catch (err: any) {
      setResultModalData({
        title: '操作失败',
        message: err.message || '删除课程表日程失败',
        isError: true
      });
      setShowResultModal(true);
    } finally {
      setSyncLoading(false);
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
          <CardTitle>连接状态与控制</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="control-section" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
            <h4 className="section-title">服务连接</h4>
            <div className="action-grid">
              {/* Microsoft To Do Card */}
              <div className="action-card">
                <div className="action-icon-wrapper microsoft">
                  <ListTodo size={20} />
                </div>
                <div className="action-info">
                  <span className="action-title">Microsoft To Do</span>
                  <span className="action-desc">
                    {msTodoStatus?.connected ? '已连接到 Microsoft' : '未连接，点击连接'}
                  </span>
                </div>
                {msTodoStatus?.connected ? (
                  <Badge variant="success">已连接</Badge>
                ) : (
                  <Button 
                    onClick={handleConnectMicrosoft} 
                    variant="primary"
                    size="sm"
                    className="action-btn"
                  >
                    连接
                  </Button>
                )}
              </div>

              {/* Ebridge Card */}
              <div className="action-card">
                <div className="action-icon-wrapper ebridge">
                  <Link size={20} />
                </div>
                <div className="action-info">
                  <span className="action-title">Ebridge 教务系统</span>
                  <span className="action-desc">
                    {ebridgeStatus?.connected ? '已连接到教务系统' : '未连接，点击连接'}
                  </span>
                </div>
                {ebridgeStatus?.connected ? (
                  <Badge variant="success">已连接</Badge>
                ) : (
                  <Button 
                    onClick={() => setShowEbridgeConnectModal(true)} 
                    variant="primary"
                    size="sm"
                    className="action-btn"
                  >
                    连接
                  </Button>
                )}
              </div>
            </div>
          </div>
          
          {ebridgeStatus?.connected && (
            <div className="control-section">
              <h4 className="section-title">课表管理</h4>
              <div className="action-grid">
                <div className="action-card">
                  <div className="action-icon-wrapper sync">
                    <Download size={20} />
                  </div>
                  <div className="action-info">
                    <span className="action-title">同步课表</span>
                    <span className="action-desc">从 Ebridge 获取最新课程</span>
                  </div>
                  <Button 
                    onClick={handleSyncTimetable} 
                    disabled={syncLoading}
                    variant="secondary"
                    size="sm"
                    className="action-btn"
                  >
                    {syncLoading ? '同步中...' : '立即同步'}
                  </Button>
                </div>

                <div className="action-card danger">
                  <div className="action-icon-wrapper delete">
                    <Trash2 size={20} />
                  </div>
                  <div className="action-info">
                    <span className="action-title">清空课表</span>
                    <span className="action-desc">删除所有导入的课程日程</span>
                  </div>
                  <Button 
                    onClick={handleDeleteTimetable} 
                    disabled={syncLoading}
                    variant="danger"
                    size="sm"
                    className="action-btn"
                  >
                    删除全部
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="global-actions">
             <Button variant="outline" onClick={handleRefreshStatus} size="sm">
              <RefreshCw size={14} style={{marginRight: '6px'}}/> 刷新状态
            </Button>
             <Button variant="outline" onClick={handleCopyToken} size="sm">
              {tokenCopied ? <Check size={14} style={{marginRight: '6px'}}/> : <Copy size={14} style={{marginRight: '6px'}}/>}
              {tokenCopied ? '已复制' : '复制 MCP Token'}
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

        <Card>
          <CardHeader>
            <CardTitle>周次设置</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <strong>当前周（含偏移）: </strong>
                {weekInfo ? weekInfo.effectiveWeek : '加载中...'}
              </div>
              <div>
                <small>学年基准周: {weekInfo ? weekInfo.rawWeekNumber : '-'}, 全局偏移: {weekInfo ? weekInfo.globalWeekOffset : '-'}, 您的偏移: {weekInfo ? weekInfo.userWeekOffset : '-'}</small>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Button onClick={() => { setWeekError(''); setDesiredWeek(''); setShowWeekModal(true); }}>
                  设置当前周数
                </Button>
              </div>
              {weekError && <div className="error-message">{weekError}</div>}
            </div>
          </CardContent>
        </Card>

        {renderConnectionStatus()}

        <Modal
          isOpen={showEbridgeConnectModal}
          onClose={() => setShowEbridgeConnectModal(false)}
          title="连接 Ebridge 教务系统"
        >
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
              placeholder="例如: san.zhang23"
            />
            <Input
              label="Ebridge 密码"
              type="password"
              id="ebPassword"
              value={ebPassword}
              onChange={(e) => setEbPassword(e.target.value)}
              required
              placeholder="请输入您的 Ebridge 登录密码"
            />
            <Input
              label="平台登录密码"
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="请输入本平台的登录密码以验证身份"
            />
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <Button type="button" variant="secondary" onClick={() => setShowEbridgeConnectModal(false)}>
                取消
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? '连接中...' : '确认连接'}
              </Button>
            </div>
          </form>
        </Modal>
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

        <Modal
          isOpen={showDeleteConfirmModal}
          onClose={() => setShowDeleteConfirmModal(false)}
          title="确认删除"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <Button variant="secondary" onClick={() => setShowDeleteConfirmModal(false)}>
                取消
              </Button>
              <Button variant="danger" onClick={executeDeleteTimetable}>
                确认删除
              </Button>
            </div>
          }
        >
          <p>确定要删除所有课程表导入的日程吗？此操作无法撤销。</p>
        </Modal>

        <Modal
          isOpen={showResultModal}
          onClose={() => setShowResultModal(false)}
          title={resultModalData.title}
          footer={
            <Button onClick={() => setShowResultModal(false)}>
              确定
            </Button>
          }
        >
          <p className={resultModalData.isError ? "error-message" : "success-message"} style={{ margin: 0 }}>
            {resultModalData.message}
          </p>
        </Modal>

        <Modal
          isOpen={showWeekModal}
          onClose={() => setShowWeekModal(false)}
          title="设置当前周数"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <Button variant="secondary" onClick={() => setShowWeekModal(false)} disabled={weekLoading}>
                取消
              </Button>
              <Button onClick={async () => {
                setWeekError('');
                setWeekLoading(true);
                try {
                  if (desiredWeek === '') throw new Error('请输入周数');
                  await setCurrentWeek(Number(desiredWeek));
                  setShowWeekModal(false);
                } catch (err: any) {
                  setWeekError(err.message || '设置失败');
                } finally {
                  setWeekLoading(false);
                }
              }} disabled={weekLoading}>
                {weekLoading ? '保存中...' : '保存'}
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <strong>当前周（含偏移）: </strong>{weekInfo ? weekInfo.effectiveWeek : '加载中...'}
            </div>
            <div>
              <small>学年基准周: {weekInfo ? weekInfo.rawWeekNumber : '-'}, 全局偏移: {weekInfo ? weekInfo.globalWeekOffset : '-'}, 您的偏移: {weekInfo ? weekInfo.userWeekOffset : '-'}</small>
            </div>
            <Input
              label="设置当前周数"
              type="number"
              id="desiredWeekModal"
              value={desiredWeek}
              onChange={(e) => setDesiredWeek(e.target.value === '' ? '' : parseInt(e.target.value))}
              placeholder="输入想要的当前周（例如 5）"
            />
            {weekError && <div className="error-message">{weekError}</div>}
          </div>
        </Modal>
      </main>
    </div>
  );
};

export default Dashboard;