import { useState } from 'react';
import { Link } from 'react-router-dom';
import { login, setToken } from '../services/api';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import '../styles/AuthForms.css';

interface LoginProps {
  onLoginSuccess: () => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await login({ email, password });
      setToken(response.token);
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || '登录失败，请检查邮箱和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <Card className="auth-card">
        <CardHeader>
          <CardTitle style={{ justifyContent: 'center' }}>登录</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <div className="error-message">{error}</div>}
          <form onSubmit={handleSubmit}>
            <Input
              label="邮箱"
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              label="密码"
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            <Button type="submit" className="auth-button-full" disabled={loading} style={{ width: '100%', marginTop: '10px' }}>
              {loading ? '登录中...' : '登录'}
            </Button>
          </form>
          <div className="switch-auth-link">
            <span>没有账户？ </span>
            <Link to="/register">立即注册</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
