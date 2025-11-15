import express from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { User, Task } from '../index';
import { logger } from '../Utils/logger.js';
import { dbService } from '../Services/dbService';
import { findConflictingTasks, ScheduleConflictError } from '../Services/scheduleConflict';
import { broadcastTaskChange } from '../Services/websocket';

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

  // 创建任务（带冲突检测 + boundary 配置 + 重复实例统计）
  router.post('/tasks', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const { name, description, startTime, endTime, dueDate, location, boundaryConflict, recurrenceRule } = req.body || {};
      if (!name || !startTime || !endTime) {
        return res.status(400).json({ error: 'name, startTime, endTime required' });
      }
      const task: Task = {
        id: uuidv4(),
        name,
        description: description || '',
        startTime,
        endTime,
        dueDate: dueDate || endTime,
        location,
        completed: false,
        pushedToMSTodo: false,
      };
      const effectiveBoundary = boundaryConflict !== undefined ? !!boundaryConflict : !!user.conflictBoundaryInclusive;
      if (recurrenceRule) task.recurrenceRule = JSON.stringify(recurrenceRule);
      try {
        await dbService.addTask(user.id, task, effectiveBoundary);
      } catch (e: any) {
        if (e instanceof ScheduleConflictError) {
          return res.status(409).json({
            error: 'Task time conflicts',
            conflicts: e.conflicts.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime }))
          });
        }
        throw e;
      }
      user.tasks.push(task);
      broadcastTaskChange('created', task, user.id);
      let createdChildren = 0, conflictChildren = 0, errorChildren = 0;
      if (recurrenceRule) {
        const generated = generateRecurrenceInstances(task, recurrenceRule);
        for (const inst of generated) {
          try {
            await dbService.addTask(user.id, inst, effectiveBoundary);
            user.tasks.push(inst);
            createdChildren++;
            broadcastTaskChange('created', inst, user.id);
          } catch (e: any) {
            if (e instanceof ScheduleConflictError) {
              conflictChildren++;
            } else {
              errorChildren++;
            }
          }
        }
      }
      return res.status(201).json({
        task,
        recurrenceSummary: buildRecurrenceSummary(recurrenceRule, createdChildren, conflictChildren, errorChildren)
      });
    } catch (error) {
      logger.error('Create task failed:', error);
      return res.status(500).json({ error: 'Failed to create task' });
    }
  });

  // 冲突预检接口：返回与给定时间段冲突的任务列表（支持 boundary 覆盖）
  router.post('/tasks/conflicts', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const { startTime, endTime, boundaryConflict } = req.body || {};
      if (!startTime || !endTime) {
        return res.status(400).json({ error: 'startTime and endTime required' });
      }
      const candidate: Task = {
        id: 'candidate',
        name: 'candidate',
        description: '',
        startTime,
        endTime,
        dueDate: endTime,
        completed: false,
        pushedToMSTodo: false,
      };
      const effectiveBoundary = boundaryConflict !== undefined ? !!boundaryConflict : !!user.conflictBoundaryInclusive;
      const conflicts = findConflictingTasks(user.tasks || [], candidate, { boundaryConflict: effectiveBoundary });
      return res.status(200).json({ conflicts });
    } catch (error) {
      logger.error('Conflict pre-check failed:', error);
      return res.status(500).json({ error: 'Failed to check conflicts' });
    }
  });

  // 批量创建任务（部分成功 & 冲突与错误分离）
  router.post('/tasks/batch', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const { tasks, boundaryConflict } = req.body || {};
      if (!Array.isArray(tasks) || tasks.length === 0) {
        return res.status(400).json({ error: 'tasks array required' });
      }
      const results: any[] = [];
      let created = 0, conflictsCount = 0, errors = 0;
      const batchBoundary = boundaryConflict !== undefined ? !!boundaryConflict : undefined;

      for (const input of tasks) {
        const { name, description, startTime, endTime, dueDate, location, recurrenceRule } = input || {};
        if (!name || !startTime || !endTime) {
          results.push({ input, status: 'error', errorMessage: 'name, startTime, endTime required' });
          errors++;
          continue;
        }
        const effectiveBoundary = input.boundaryConflict !== undefined ? !!input.boundaryConflict : (batchBoundary !== undefined ? batchBoundary : !!user.conflictBoundaryInclusive);
        const task: Task = {
          id: uuidv4(),
          name,
          description: description || '',
          startTime,
          endTime,
          dueDate: dueDate || endTime,
          location,
          completed: false,
          pushedToMSTodo: false,
        };
        if (recurrenceRule) task.recurrenceRule = JSON.stringify(recurrenceRule);
        try {
          await dbService.addTask(user.id, task, effectiveBoundary);
          user.tasks.push(task);
          broadcastTaskChange('created', task, user.id);
          let createdChildren = 0, conflictChildren = 0, errorChildren = 0;
          if (recurrenceRule) {
            const generated = generateRecurrenceInstances(task, recurrenceRule);
            for (const inst of generated) {
              try {
                await dbService.addTask(user.id, inst, effectiveBoundary);
                user.tasks.push(inst);
                createdChildren++;
                broadcastTaskChange('created', inst, user.id);
              } catch (e: any) {
                if (e instanceof ScheduleConflictError) {
                  conflictChildren++;
                } else {
                  errorChildren++;
                }
              }
            }
            results.push({ input, status: 'created', task, recurrenceSummary: buildRecurrenceSummary(recurrenceRule, createdChildren, conflictChildren, errorChildren) });
          } else {
            results.push({ input, status: 'created', task });
          }
          created++;
        } catch (e: any) {
          if (e instanceof ScheduleConflictError) {
            conflictsCount++;
            results.push({
              input,
              status: 'conflict',
              conflictList: e.conflicts.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime }))
            });
          } else {
            errors++;
            results.push({ input, status: 'error', errorMessage: e?.message || 'unknown error' });
          }
        }
      }
      return res.status(200).json({
        results,
        summary: { total: tasks.length, created, conflicts: conflictsCount, errors }
      });
    } catch (error) {
      logger.error('Batch task creation failed:', error);
      return res.status(500).json({ error: 'Failed to create batch tasks' });
    }
  });

  // 设置用户级冲突边界模式
  router.post('/settings/conflict-mode', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const { boundaryConflictInclusive } = req.body || {};
      if (typeof boundaryConflictInclusive !== 'boolean') {
        return res.status(400).json({ error: 'boundaryConflictInclusive boolean required' });
      }
      user.conflictBoundaryInclusive = boundaryConflictInclusive;
      await dbService.updateUser(user);
      return res.status(200).json({ boundaryConflictInclusive, updatedAt: new Date().toISOString() });
    } catch (error) {
      logger.error('Failed to update conflict mode:', error);
      return res.status(500).json({ error: 'Failed to update conflict mode' });
    }
  });

  // 更新任务（部分字段 + 冲突检测）
  router.put('/tasks/:id', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const taskId = req.params.id;
      const existing = user.tasks.find(t => t.id === taskId);
      if (!existing) return res.status(404).json({ error: 'task not found' });
      const { name, description, startTime, endTime, dueDate, location, completed, boundaryConflict } = req.body || {};

      // 构建更新后的任务对象（不直接修改原对象，先复制）
      const updated: Task = {
        ...existing,
        name: name !== undefined ? name : existing.name,
        description: description !== undefined ? description : existing.description,
        startTime: startTime !== undefined ? startTime : existing.startTime,
        endTime: endTime !== undefined ? endTime : existing.endTime,
        dueDate: dueDate !== undefined ? dueDate : existing.dueDate,
        location: location !== undefined ? location : existing.location,
        completed: completed !== undefined ? !!completed : existing.completed,
      };
      try {
        const effectiveBoundary = boundaryConflict !== undefined ? !!boundaryConflict : !!user.conflictBoundaryInclusive;
        await dbService.updateTask(updated, effectiveBoundary);
        // 同步内存缓存
        const idx = user.tasks.findIndex(t => t.id === taskId);
        if (idx >= 0) user.tasks[idx] = updated;
        broadcastTaskChange('updated', updated, user.id);
        if (completed === true && !existing.completed) {
          broadcastTaskChange('completed', updated, user.id);
        }
        return res.status(200).json({ task: updated });
      } catch (e: any) {
        if (e instanceof ScheduleConflictError) {
          return res.status(409).json({
            error: 'conflict',
            message: e.message,
            candidate: { id: updated.id, name: updated.name, startTime: updated.startTime, endTime: updated.endTime },
            conflicts: e.conflicts.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime }))
          });
        }
        logger.error('Failed to update task:', e);
        return res.status(500).json({ error: 'Failed to update task' });
      }
    } catch (error) {
      logger.error('Unexpected error in PUT /tasks/:id:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 删除任务
  router.delete('/tasks/:id', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const taskId = req.params.id;
      const existingIndex = user.tasks.findIndex(t => t.id === taskId);
      if (existingIndex < 0) return res.status(404).json({ error: 'task not found' });
      const deletedOk = await dbService.deleteTask(taskId);
      if (deletedOk) {
        const deletedTask = user.tasks[existingIndex];
        user.tasks.splice(existingIndex, 1);
        broadcastTaskChange('deleted', deletedTask, user.id);
        return res.status(200).json({ id: taskId, deleted: true });
      }
      return res.status(500).json({ error: 'Failed to delete task' });
    } catch (error) {
      logger.error('Unexpected error in DELETE /tasks/:id:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 列出任务（支持时间过滤与分页）
  router.get('/tasks', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const { start, end, limit = '50', offset = '0', q, completed } = req.query;
      const limNum = Math.max(1, Math.min(200, parseInt(limit as string, 10) || 50));
      const offNum = Math.max(0, parseInt(offset as string, 10) || 0);
      let tasks = user.tasks || [];
      if (start || end) {
        const startDate = start ? new Date(start as string) : null;
        const endDate = end ? new Date(end as string) : null;
        tasks = tasks.filter(t => {
          if (!t.startTime || !t.endTime) return false;
          const s = new Date(t.startTime);
          const e = new Date(t.endTime);
          if (startDate && e < startDate) return false;
          if (endDate && s > endDate) return false;
          return true;
        });
      }
      if (typeof completed === 'string') {
        const want = completed.toLowerCase() === 'true';
        tasks = tasks.filter(t => t.completed === want);
      }
      if (typeof q === 'string' && q.trim().length > 0) {
        const keyword = q.trim().toLowerCase();
        tasks = tasks.filter(t => (
          (t.name && t.name.toLowerCase().includes(keyword)) ||
          (t.description && t.description.toLowerCase().includes(keyword)) ||
          (t.location && t.location.toLowerCase().includes(keyword))
        ));
      }
      const total = tasks.length;
      const paged = tasks.slice(offNum, offNum + limNum);
      return res.status(200).json({ tasks: paged, total, limit: limNum, offset: offNum });
    } catch (error) {
      logger.error('Failed to list tasks:', error);
      return res.status(500).json({ error: 'Failed to list tasks' });
    }
  });

  // ---- 工具函数：生成重复任务实例 ----
  function generateRecurrenceInstances(root: Task, rule: any): Task[] {
    const instances: Task[] = [];
    try {
      const freq = rule.freq;
      const interval = rule.interval && rule.interval > 0 ? rule.interval : 1;
      const count: number | undefined = rule.count;
      const until: Date | undefined = rule.until ? new Date(rule.until) : undefined;
      const byDay: string[] | undefined = Array.isArray(rule.byDay) ? rule.byDay : undefined;
      const start = new Date(root.startTime);
      const end = new Date(root.endTime);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return instances;
      const maxIterations = count ? count - 1 : 500; // root 已占一次，剩余生成
      let generated = 0;
      if (freq === 'daily') {
        let cursorStart = new Date(start);
        let cursorEnd = new Date(end);
        while (generated < maxIterations) {
          cursorStart.setDate(cursorStart.getDate() + interval);
          cursorEnd.setDate(cursorEnd.getDate() + interval);
          if (until && cursorStart > until) break;
          instances.push(buildInstance(root, cursorStart, cursorEnd));
          generated++;
          if (!count && until && cursorStart > until) break;
          if (!count && !until && generated >= 30) break;
        }
      } else if (freq === 'weekly') {
        const rootDay = start.getDay();
        const dayMap: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
        const byDayIdx = byDay?.map(d => dayMap[d])?.filter(d => d !== undefined) || [];
        let weekOffset = 0;
        while (generated < maxIterations) {
          const baseWeekStart = new Date(start);
          baseWeekStart.setDate(start.getDate() + weekOffset * 7 * interval);
          // 如果没有 byDay 则沿用原逻辑：每周一次同 weekday
          if (byDayIdx.length === 0) {
            if (weekOffset > 0) {
              const cursorStart = new Date(start);
              cursorStart.setDate(start.getDate() + weekOffset * 7 * interval);
              const cursorEnd = new Date(end);
              cursorEnd.setDate(end.getDate() + weekOffset * 7 * interval);
              if (until && cursorStart > until) break;
              instances.push(buildInstance(root, cursorStart, cursorEnd));
              generated++;
              if (!count && until && cursorStart > until) break;
              if (!count && !until && generated >= 30) break;
            }
          } else {
            // byDay 模式：对一周内所有指定 day 生成实例
            for (const targetDay of byDayIdx) {
              if (generated >= maxIterations) break;
              // 计算该周的目标日期
              const dayDiff = targetDay - rootDay;
              const cursorStart = new Date(baseWeekStart);
              cursorStart.setDate(baseWeekStart.getDate() + dayDiff);
              const cursorEnd = new Date(cursorStart);
              cursorEnd.setHours(end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds());
              // root 已经存在，不重复生成 root 自身的日期
              if (cursorStart.getTime() === start.getTime()) continue;
              if (until && cursorStart > until) { generated = maxIterations; break; }
              instances.push(buildInstance(root, cursorStart, cursorEnd));
              generated++;
              if (!count && until && cursorStart > until) break;
              if (!count && !until && generated >= 30) break;
            }
          }
          weekOffset++;
        }
      }
    } catch (_) {
      return instances;
    }
    return instances;
  }

  function buildInstance(root: Task, s: Date, e: Date): Task {
    return {
      id: uuidv4(),
      name: root.name,
      description: root.description,
      startTime: s.toISOString(),
      endTime: e.toISOString(),
      dueDate: e.toISOString(),
      location: root.location,
      completed: false,
      pushedToMSTodo: false,
      parentTaskId: root.id
    };
  }

  function buildRecurrenceSummary(rule: any, created: number, conflicts: number, errors: number) {
    if (!rule) return null;
    return { createdInstances: created, conflictInstances: conflicts, errorInstances: errors, requestedRule: rule };
  }

  // 获取某任务的所有重复实例
  router.get('/tasks/:id/occurrences', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const rootId = req.params.id;
      const root = (user.tasks || []).find(t => t.id === rootId);
      if (!root) return res.status(404).json({ error: 'Task not found' });
      const children = (user.tasks || []).filter(t => t.parentTaskId === root.id);
      children.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      return res.status(200).json({ rootTask: root, occurrences: children });
    } catch (e) {
      logger.error('Fetch occurrences failed', e);
      return res.status(500).json({ error: 'Failed to fetch occurrences' });
    }
  });

  return router;
}