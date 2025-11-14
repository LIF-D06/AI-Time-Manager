import express from 'express';
import axios from 'axios';
import { User } from '../index';
import { logger } from '../Utils/logger.js';

// 身份验证中间件引用
export interface AuthMiddleware {
  (req: any, res: any, next: any): Promise<void>;
}

export function initializeApiRoutes(authenticateToken: AuthMiddleware) {
  // 创建路由器 - 每次调用都创建新的实例
  const router = express.Router();

  // 查询MicrosoftTODO接口状态的API端点
  router.post('/status/microsoft-todo', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const status = {
        connected: !!user.MStoken,
        binded: user.MSbinded,
        tokenAvailable: !!user.MStoken,
        lastChecked: new Date().toISOString()
      };
      
      // 如果有token，尝试验证token是否有效
      if (user.MStoken) {
        try {
          const graphEndpoint = `https://graph.microsoft.com/v1.0/me/todo/lists?$top=1`;
          const headers = { Authorization: `Bearer ${user.MStoken}` };
          await axios.get(graphEndpoint, { headers });
          status.connected = true;
        } catch (error) {
          status.connected = false;
          logger.error('Microsoft Todo API check failed:', error);
        }
      }
      
      res.status(200).json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to check Microsoft Todo status' });
    }
  });

  // 查询Ebridge接口状态的API端点
  router.post('/status/ebridge', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const status: any = {
        connected: user.ebridgeBinded,
        binded: !!user.XJTLUPassword,
        passwordAvailable: !!user.XJTLUPassword,
        emsClientAvailable: !!user.emsClient,
        timetableUrl: null,
        lastChecked: new Date().toISOString()
      };
      
      // 立即发送响应给客户端
      res.status(200).json(status);

    } catch (error) {
      // 如果在准备响应时出错，发送错误响应
      res.status(500).json({ error: 'Failed to check Ebridge status' });
    }
  });

  return router;
}