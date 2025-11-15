import express from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { User, Task } from '../index';
import { logger } from '../Utils/logger.js';
import { dbService } from '../Services/dbService';
import { findConflictingTasks, ScheduleConflictError } from '../Services/scheduleConflict';
import { generateRecurrenceInstances, buildRecurrenceSummary } from '../Services/recurrence';
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
      broadcastTaskChange('created', task, user.id);
      let createdChildren = 0, conflictChildren = 0, errorChildren = 0;
      const createdIds: string[] = [task.id];
      if (recurrenceRule) {
        const generated = generateRecurrenceInstances(task, recurrenceRule);
        for (const inst of generated) {
            try {
            await dbService.addTask(user.id, inst, effectiveBoundary);
            createdChildren++;
            createdIds.push(inst.id);
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
      // 增量刷新缓存：仅合并新建的任务
      await dbService.refreshUserTasksIncremental(user, { addedIds: createdIds });
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
          broadcastTaskChange('created', task, user.id);
          let createdChildren = 0, conflictChildren = 0, errorChildren = 0;
          const createdIds: string[] = [task.id];
          if (recurrenceRule) {
            const generated = generateRecurrenceInstances(task, recurrenceRule);
            for (const inst of generated) {
              try {
                await dbService.addTask(user.id, inst, effectiveBoundary);
                createdChildren++;
                createdIds.push(inst.id);
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
          // 增量刷新缓存：合并新建 id
          await dbService.refreshUserTasksIncremental(user, { addedIds: createdIds });
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
        broadcastTaskChange('updated', updated, user.id);
        if (completed === true && !existing.completed) {
          broadcastTaskChange('completed', updated, user.id);
        }
        // 增量刷新缓存：仅合并被更新的任务
        await dbService.refreshUserTasksIncremental(user, { updatedIds: [updated.id] });
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

  // 删除任务（支持级联删除 cascade=true）
  router.delete('/tasks/:id', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const taskId = req.params.id;
      const existingIndex = user.tasks.findIndex(t => t.id === taskId);
      if (existingIndex < 0) return res.status(404).json({ error: 'task not found' });
      const cascade = (req.query.cascade || 'false').toString().toLowerCase() === 'true';
      if (!cascade) {
        const deletedTask = user.tasks[existingIndex];
        const deletedOk = await dbService.deleteTask(taskId);
        if (deletedOk) {
          broadcastTaskChange('deleted', deletedTask, user.id);
          // 增量刷新缓存：移除已删除 id
          await dbService.refreshUserTasksIncremental(user, { deletedIds: [taskId] });
          return res.status(200).json({ id: taskId, deleted: true });
        }
        return res.status(500).json({ error: 'Failed to delete task' });
      } else {
        // 级联删除：删除根任务和所有 parentTaskId 指向它的子实例
        const toDeleteIds = new Set<string>();
        toDeleteIds.add(taskId);
        // 收集子实例
        for (const t of user.tasks) {
          if (t.parentTaskId === taskId) toDeleteIds.add(t.id);
        }
        const deletedItems: Task[] = [];
        let anyFailed = false;
        for (const id of Array.from(toDeleteIds)) {
          try {
            const ok = await dbService.deleteTask(id);
            if (ok) {
              const item = user.tasks.find(tt => tt.id === id);
              if (item) deletedItems.push(item);
            } else {
              anyFailed = true;
            }
          } catch (e) {
            anyFailed = true;
          }
        }
        // 广播已删除项
        for (const del of deletedItems) {
          broadcastTaskChange('deleted', del, user.id);
        }
        if (anyFailed) return res.status(500).json({ error: 'Failed to fully delete cascade tasks' });
        // 增量刷新缓存：移除已删除的所有 id
        await dbService.refreshUserTasksIncremental(user, { deletedIds: Array.from(toDeleteIds) });
        return res.status(200).json({ id: taskId, deleted: true, cascadeDeleted: true, count: toDeleteIds.size });
      }
    } catch (error) {
      logger.error('Unexpected error in DELETE /tasks/:id:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 列出任务（支持时间过滤、分页与排序）
  // 支持 query: start,end,page,limit OR offset, sortBy=(startTime|dueDate|name), order=(asc|desc)
  router.get('/tasks', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const { start, end, limit = '50', offset, page, q, completed, sortBy, order } = req.query;
      const limNum = Math.max(1, Math.min(200, parseInt((limit as string) || '50', 10) || 50));
      let offNum = 0;
      if (typeof page !== 'undefined') {
        const pageNum = Math.max(0, parseInt(page as string, 10) || 0);
        offNum = pageNum * limNum;
      } else {
        offNum = Math.max(0, parseInt((offset as string) || '0', 10) || 0);
      }

      const opts: any = { start: start as string | undefined, end: end as string | undefined, q: q as string | undefined, completed: typeof completed === 'string' ? (completed.toLowerCase() === 'true') : undefined, limit: limNum, offset: offNum, sortBy: sortBy as string | undefined, order: (order as any) };
      const { tasks, total } = await dbService.getTasksPage(user.id, opts);
      return res.status(200).json({ tasks, total, limit: limNum, offset: offNum, sortBy: opts.sortBy || 'startTime', order: opts.order || 'asc' });
    } catch (error) {
      logger.error('Failed to list tasks:', error);
      return res.status(500).json({ error: 'Failed to list tasks' });
    }
  });

  // recurrence helpers moved to server/Services/recurrence.ts

  // 获取某任务的所有重复实例（支持分页：page & limit，或 offset & limit；支持 sortBy & order）
  router.get('/tasks/:id/occurrences', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const rootId = req.params.id;
      const { limit = '50', offset, page, sortBy = 'startTime', order = 'asc' } = req.query;
      const limNum = Math.max(1, Math.min(500, parseInt((limit as string) || '50', 10) || 50));
      let offNum = 0;
      if (typeof page !== 'undefined') {
        const pageNum = Math.max(0, parseInt(page as string, 10) || 0);
        offNum = pageNum * limNum;
      } else {
        offNum = Math.max(0, parseInt((offset as string) || '0', 10) || 0);
      }

      const root = await dbService.getTaskById(rootId);
      if (!root) return res.status(404).json({ error: 'Task not found' });
      const { occurrences, total } = await dbService.getOccurrencesPage(user.id, rootId, { limit: limNum, offset: offNum, sortBy: sortBy as string, order: (order as any) });
      return res.status(200).json({ rootTask: root, occurrences, total, limit: limNum, offset: offNum, sortBy: sortBy || 'startTime', order: order || 'asc' });
    } catch (e) {
      logger.error('Fetch occurrences failed', e);
      return res.status(500).json({ error: 'Failed to fetch occurrences' });
    }
  });

  return router;
}