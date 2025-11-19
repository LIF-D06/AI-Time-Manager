import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Task, User } from '../index';
import { logger } from '../Utils/logger.js';
import jwt from 'jsonwebtoken';

let wss: WebSocketServer | null = null;
let userProvider: (() => Iterable<User>) | null = null;
const occurrenceNotified = new Set<string>();
const JWT_SECRET = process.env.JWT_SECRET || '';

interface AuthedSocket extends WebSocket { userId?: string; isAlive?: boolean; }
let heartbeatInterval: NodeJS.Timeout | null = null;

export function initWebSocket(httpServer: any, provider: () => Iterable<User>) {
  userProvider = provider;
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', (socket: AuthedSocket, req: IncomingMessage) => {
    // heartbeat init
    socket.isAlive = true;
    socket.on && socket.on('pong', () => { socket.isAlive = true; });

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (!token) {
      try { socket.send(JSON.stringify({ type: 'error', error: 'AUTH_REQUIRED' })); } catch(_){}
      try { socket.close(); } catch(_){}
      return;
    }
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.sub;
      try { socket.send(JSON.stringify({ type: 'welcome', time: new Date().toISOString(), userId: socket.userId })); } catch(_){}
    } catch (e) {
      try { socket.send(JSON.stringify({ type: 'error', error: 'INVALID_TOKEN' })); } catch(_){}
      try { socket.close(); } catch(_){}
      return;
    }
  });

  // heartbeat interval
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (!wss) return;
    for (const client of wss.clients) {
      const s = client as AuthedSocket;
      if (s.isAlive === false) {
        try { client.terminate(); } catch (_) {}
        continue;
      }
      s.isAlive = false;
      try { (client as any).ping?.(); } catch (_) {}
    }
  }, 30000);

  wss.on('close', () => {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  });
  startOccurrenceScan();
  logger.info('WebSocket server with JWT auth initialized at /ws');
}

export function broadcastTaskChange(action: 'created' | 'updated' | 'deleted' | 'completed', task: Task, userId: string) {
  if (!wss) return;
  const payload = JSON.stringify({
    type: 'taskChange',
    action,
    task: {
      id: task.id,
      name: task.name,
      startTime: task.startTime,
      endTime: task.endTime,
      completed: task.completed,
      parentTaskId: task.parentTaskId,
      recurrenceRule: task.recurrenceRule
    }
  });
  for (const client of wss.clients) {
    const c = client as AuthedSocket;
    if (c.userId !== userId) continue;
    if ((client as any).readyState === 1) {
      try { client.send(payload); } catch (_) {}
    }
  }
}

export function broadcastUserLog(userId: string, log: { id: string; time: string; type: string; message: string; payload?: any }) {
  if (!wss) return;
  const payload = JSON.stringify({ type: 'userLog', log });
  for (const client of wss.clients) {
    const c = client as AuthedSocket;
    if (c.userId !== userId) continue;
    if ((client as any).readyState === 1) {
      try { client.send(payload); } catch (_) {}
    }
  }
}

function broadcastTaskOccurrence(task: Task, userId: string) {
  if (!wss) return;
  const payload = JSON.stringify({
    type: 'taskOccurrence',
    taskId: task.id,
    name: task.name,
    startTime: task.startTime,
    endTime: task.endTime
  });
  for (const client of wss.clients) {
    const c = client as AuthedSocket;
    if (c.userId !== userId) continue;
    if ((client as any).readyState === 1) {
      try { client.send(payload); } catch (_) {}
    }
  }
}

function broadcastTaskOccurrenceCanceled(task: Task, userId: string) {
  if (!wss) return;
  const payload = JSON.stringify({ type: 'taskOccurrenceCanceled', taskId: task.id, startTime: task.startTime });
  for (const client of wss.clients) {
    const c = client as AuthedSocket;
    if (c.userId !== userId) continue;
    if ((client as any).readyState === 1) {
      try { client.send(payload); } catch (_) {}
    }
  }
}

function startOccurrenceScan() {
  setInterval(() => {
    if (!userProvider) return;
    const now = Date.now();
    for (const user of userProvider()) {
      for (const task of user.tasks || []) {
        if (!task.startTime) continue;
        const startMillis = new Date(task.startTime).getTime();
        if (isNaN(startMillis)) continue;
        if (task.completed && !occurrenceNotified.has(task.id)) {
          // 已完成且未开始 -> 取消事件
          if (startMillis > now) {
            occurrenceNotified.add(task.id);
            broadcastTaskOccurrenceCanceled(task, user.id);
          }
          continue;
        }
        if (startMillis <= now && !task.completed && !occurrenceNotified.has(task.id)) {
          occurrenceNotified.add(task.id);
          broadcastTaskOccurrence(task, user.id);
          logger.info(`Broadcast task occurrence ${task.id}`);
        }
      }
    }
  }, 5000);
}
