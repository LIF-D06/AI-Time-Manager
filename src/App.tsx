import { useState, useEffect } from 'react';
import { WeekProvider } from './context/WeekContext';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated, removeToken, authEvents } from './services/api';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import { Modal } from './components/ui/Modal';
import { Button } from './components/ui/Button';
import './App.css';
import ScheduleQueueNotifier from './components/ScheduleQueueNotifier';

function App() {
  const [isAuth, setIsAuth] = useState<boolean>(isAuthenticated());
  const [showSessionExpiredModal, setShowSessionExpiredModal] = useState(false);

  useEffect(() => {
    const handleUnauthorized = () => {
      setShowSessionExpiredModal(true);
    };
    
    authEvents.addEventListener('unauthorized', handleUnauthorized);
    
    return () => {
      authEvents.removeEventListener('unauthorized', handleUnauthorized);
    };
  }, []);

  const handleLoginSuccess = () => {
    setIsAuth(true);
  };

  const handleLogout = () => {
    removeToken();
    setIsAuth(false);
  };

  const handleSessionExpired = () => {
    setShowSessionExpiredModal(false);
    handleLogout();
  };

  return (
    <Router>
      <WeekProvider>
      <div className="app-container">
        <ScheduleQueueNotifier />
        <Routes>
          <Route 
            path="/login" 
            element={!isAuth ? <Login onLoginSuccess={handleLoginSuccess} /> : <Navigate to="/" />} 
          />
          <Route 
            path="/register" 
            element={!isAuth ? <Register onRegisterSuccess={handleLoginSuccess} /> : <Navigate to="/" />} 
          />
          
          <Route 
            path="/" 
            element={isAuth ? <Navigate to="/dashboard" /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/dashboard" 
            element={isAuth ? <Dashboard onLogout={handleLogout} view="dashboard" /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/schedule/today" 
            element={isAuth ? <Dashboard onLogout={handleLogout} view="today-schedule" /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/schedule/all" 
            element={isAuth ? <Dashboard onLogout={handleLogout} view="all-schedule" /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/schedule/search" 
            element={isAuth ? <Dashboard onLogout={handleLogout} view="search-schedule" /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/schedule/queue" 
            element={isAuth ? <Dashboard onLogout={handleLogout} view="queue" /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/chat" 
            element={isAuth ? <Dashboard onLogout={handleLogout} view="chat" /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/logs" 
            element={isAuth ? <Dashboard onLogout={handleLogout} view="logs" /> : <Navigate to="/login" />} 
          />
          
          <Route 
            path="*" 
            element={isAuth ? <Navigate to="/dashboard" /> : <Navigate to="/login" />} 
          />
        </Routes>
        
        <Modal
          isOpen={showSessionExpiredModal}
          onClose={() => {}} // Prevent closing by clicking outside
          title="会话已过期"
          closeOnOverlayClick={false}
        >
          <p>您的登录会话已过期，请重新登录。</p>
          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={handleSessionExpired}>重新登录</Button>
          </div>
        </Modal>
      </div>
      </WeekProvider>
    </Router>
  );
}

export default App;
