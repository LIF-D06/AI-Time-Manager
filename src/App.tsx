import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import AllSchedule from './components/Schedule/AllSchedule';
import TodaySchedule from './components/Schedule/TodaySchedule';
import LogViewer from './components/Logs/LogViewer';
import { isAuthenticated } from './services/api';
import './App.css';

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuth, setIsAuth] = useState(false);

  useEffect(() => {
    setIsAuth(isAuthenticated());
    setIsLoading(false);
  }, []);

  const handleLoginSuccess = () => {
    setIsAuth(true);
  };

  const handleLogout = () => {
    setIsAuth(false);
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
    <Router>
      <div className="app">
        <Routes>
          <Route path="/login" element={!isAuth ? <Login onLoginSuccess={handleLoginSuccess} /> : <Navigate to="/dashboard" />} />
          <Route path="/register" element={!isAuth ? <Register onRegisterSuccess={handleLoginSuccess} /> : <Navigate to="/dashboard" />} />
          
          <Route path="/dashboard" element={isAuth ? <Dashboard onLogout={handleLogout} /> : <Navigate to="/login" />}>
             {/* Dashboard will handle sub-routes or we can define them here if Dashboard has an Outlet */}
          </Route>
          
          {/* We might need to restructure Dashboard to be a layout or include navigation */}
          <Route path="/schedule/all" element={isAuth ? <Dashboard onLogout={handleLogout} view="all-schedule" /> : <Navigate to="/login" />} />
          <Route path="/schedule/today" element={isAuth ? <Dashboard onLogout={handleLogout} view="today-schedule" /> : <Navigate to="/login" />} />
          <Route path="/logs" element={isAuth ? <Dashboard onLogout={handleLogout} view="logs" /> : <Navigate to="/login" />} />
          <Route path="/chat" element={isAuth ? <Dashboard onLogout={handleLogout} view="chat" /> : <Navigate to="/login" />} />

          <Route path="/" element={<Navigate to={isAuth ? "/dashboard" : "/login"} />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
