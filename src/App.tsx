import { useState, useEffect } from 'react';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import { isAuthenticated } from './services/api';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState<'login' | 'register' | 'dashboard'>('login');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 检查是否已登录
    if (isAuthenticated()) {
      setCurrentView('dashboard');
    }
    setIsLoading(false);
  }, []);

  const handleLoginSuccess = () => {
    setCurrentView('dashboard');
  };

  const handleRegisterSuccess = () => {
    setCurrentView('dashboard');
  };

  const handleLogout = () => {
    setCurrentView('login');
  };

  const switchToRegister = () => {
    setCurrentView('register');
  };

  const switchToLogin = () => {
    setCurrentView('login');
  };

  if (isLoading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="app">
      {currentView === 'login' && (
        <div className="auth-page">
          <Login onLoginSuccess={handleLoginSuccess} />
          <div className="switch-auth">
            <p>还没有账号？</p>
            <button className="switch-button" onClick={switchToRegister}>
              立即注册
            </button>
          </div>
        </div>
      )}

      {currentView === 'register' && (
        <div className="auth-page">
          <Register onRegisterSuccess={handleRegisterSuccess} />
          <div className="switch-auth">
            <p>已有账号？</p>
            <button className="switch-button" onClick={switchToLogin}>
              返回登录
            </button>
          </div>
        </div>
      )}

      {currentView === 'dashboard' && (
        <Dashboard onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;
