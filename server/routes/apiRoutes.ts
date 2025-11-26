
import express from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { User, Task } from '../index';
import { logger } from '../Utils/logger.js';
import { dbService } from '../Services/dbService.js';
import { mcpTools } from '../Services/mcp.js';
import { findConflictingTasks, ScheduleConflictError } from '../Services/scheduleConflict.js';
import { generateRecurrenceInstances, buildRecurrenceSummary } from '../Services/recurrence.js';
import { resolveScheduleType } from '../Services/types.js';
import type { RecurrenceRule, ScheduleType } from '../Services/types';
import { broadcastTaskChange } from '../Services/websocket.js';
import { logUserEvent } from '../Services/userLog.js';
import { LLMApi } from '../Services/LLMApi.js';
import { syncUserTimetable } from '../Services/timetable.js';

// 身份验证中间件引用
export interface AuthMiddleware {
  (req: any, res: any, next: any): Promise<void>;
}

export function initializeApiRoutes(authenticateToken: AuthMiddleware) {
  // 创建路由器 - 每次调用都创建新的实例
  const router = express.Router();

  // 初始化 LLM API
  const llmApi = new LLMApi(process.env.OPENAI_API_KEY || '', process.env.OPENAI_MODEL || 'deepseek-chat');

  // LLM 聊天接口（流式）
  router.post('/llm/chat', authenticateToken, async (req: any, res: any) => {
    try {
      const { messages, tools } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages array required' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      await llmApi.chatStream(messages, tools, (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      });

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      logger.error('LLM chat failed:', error);
      // 如果响应头还没发送，发送 JSON 错误
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Failed to process chat request' });
      }
      // 如果已经开始流式传输，发送错误事件
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

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

  // 手动触发课表同步
  router.post('/sync/timetable', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      if (!user.ebridgeBinded || !user.timetableUrl) {
        return res.status(400).json({ error: 'User not bound to Ebridge or missing timetable URL' });
      }

      const result = await syncUserTimetable(user, true);
      return res.status(200).json({
        message: 'Timetable sync completed',
        added: result.added,
        errors: result.errors
      });
    } catch (error: any) {
      logger.error('Manual timetable sync failed:', error);
      return res.status(500).json({ error: 'Failed to sync timetable', details: error.message });
    }
  });

  // 删除所有课程表导入的日程
  router.delete('/sync/timetable', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const count = await dbService.deleteTasksByPattern(user.id, 'timetable_%');

      // 刷新用户缓存
      const deletedIds = user.tasks.filter(t => t.id.startsWith('timetable_')).map(t => t.id);
      await dbService.refreshUserTasksIncremental(user, { deletedIds });

      return res.status(200).json({ message: `Successfully deleted ${count} timetable tasks`, count });
    } catch (error) {
      logger.error('Failed to delete timetable tasks:', error);
      return res.status(500).json({ error: 'Failed to delete timetable tasks' });
    }
  });

  // 获取用户日志（分页、可按时间与类型过滤）
  router.get('/logs', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const { limit = '50', offset = '0', since, until, type } = req.query;
      const lim = Math.max(1, Math.min(500, parseInt(limit as string, 10) || 50));
      const off = Math.max(0, parseInt(offset as string, 10) || 0);
      const { logs, total } = await dbService.getUserLogsPage(user.id, { limit: lim, offset: off, since: since as string | undefined, until: until as string | undefined, type: type as string | undefined });
      return res.status(200).json({ logs, total, limit: lim, offset: off });
    } catch (e) {
      logger.error('Fetch user logs failed:', e);
      return res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  // 创建任务（带冲突检测 + boundary 配置 + 重复实例统计）
  router.post('/tasks', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const { name, description, startTime, endTime, dueDate, location, boundaryConflict, recurrenceRule: recurrenceRuleInput, importance, scheduleType: scheduleTypeInput } = req.body || {};
      if (!name || !startTime || !endTime) {
        return res.status(400).json({ error: 'name, startTime, endTime required' });
      }
      let parsedRecurrence: RecurrenceRule | undefined;
      let resolvedScheduleType: ScheduleType;
      try {
        const resolved = resolveScheduleType({ explicit: scheduleTypeInput, recurrence: recurrenceRuleInput, fallback: 'single' });
        parsedRecurrence = resolved.parsedRecurrence;
        resolvedScheduleType = resolved.scheduleType;
      } catch (err: any) {
        const msg = err?.message?.includes('recurrenceRule') ? 'Invalid recurrenceRule value' : 'Invalid scheduleType value';
        return res.status(400).json({ error: msg });
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
        importance: importance || 'normal',
        scheduleType: resolvedScheduleType,
      };
      const effectiveBoundary = boundaryConflict !== undefined ? !!boundaryConflict : !!user.conflictBoundaryInclusive;
      if (parsedRecurrence) task.recurrenceRule = JSON.stringify(parsedRecurrence);

      // 冲突检测
      const conflicts = findConflictingTasks(user.tasks || [], task, { boundaryConflict: effectiveBoundary });

      try {
        await dbService.addTask(user.id, task, effectiveBoundary, true);
      } catch (e: any) {
        throw e;
      }
      broadcastTaskChange('created', task, user.id);
      if (conflicts.length > 0) {
        await logUserEvent(user.id, 'taskConflict', `Created task with conflict ${task.name}`, { id: task.id, conflicts: conflicts.map(c => c.id) });
      } else {
        await logUserEvent(user.id, 'taskCreated', `Created task ${task.name}`, { id: task.id, startTime: task.startTime, endTime: task.endTime });
      }

      let createdChildren = 0, conflictChildren = 0, errorChildren = 0;
      const createdIds: string[] = [task.id];
      const instanceConflicts: any[] = [];

      if (parsedRecurrence) {
        const generated = generateRecurrenceInstances(task, parsedRecurrence);
        for (const inst of generated) {
          try {
            const instConf = findConflictingTasks(user.tasks || [], inst, { boundaryConflict: effectiveBoundary });
            if (instConf.length > 0) {
              instanceConflicts.push({
                instance: { id: inst.id, startTime: inst.startTime, endTime: inst.endTime },
                conflicts: instConf.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime }))
              });
              await logUserEvent(user.id, 'taskConflict', `Created recurrence instance with conflict ${inst.name}`, { parentId: task.id, instanceStart: inst.startTime, instanceEnd: inst.endTime });
            } else {
              await logUserEvent(user.id, 'taskCreated', `Created recurrence instance ${inst.name}`, { id: inst.id, parentTaskId: inst.parentTaskId, startTime: inst.startTime, endTime: inst.endTime });
            }

            await dbService.addTask(user.id, inst, effectiveBoundary, true);
            createdChildren++;
            createdIds.push(inst.id);
            broadcastTaskChange('created', inst, user.id);
          } catch (e: any) {
            errorChildren++;
            await logUserEvent(user.id, 'taskError', `Error creating recurrence instance for ${task.name}`, { parentId: task.id, error: e?.message });
          }
        }
      }
      // 增量刷新缓存：仅合并新建的任务
      await dbService.refreshUserTasksIncremental(user, { addedIds: createdIds });
      return res.status(201).json({
        task,
        recurrenceSummary: buildRecurrenceSummary(parsedRecurrence, createdChildren, 0, errorChildren),
        conflictWarning: (conflicts.length > 0 || instanceConflicts.length > 0) ? {
          message: 'Task created with time conflicts',
          conflicts: conflicts.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime })),
          instanceConflicts
        } : undefined
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
        const { name, description, startTime, endTime, dueDate, location, recurrenceRule: recurrenceRuleInput, importance, scheduleType: scheduleTypeInput } = input || {};
        if (!name || !startTime || !endTime) {
          results.push({ input, status: 'error', errorMessage: 'name, startTime, endTime required' });
          errors++;
          continue;
        }
        let parsedRecurrence: RecurrenceRule | undefined;
        let resolvedScheduleType: ScheduleType;
        try {
          const resolved = resolveScheduleType({ explicit: scheduleTypeInput, recurrence: recurrenceRuleInput, fallback: 'single' });
          parsedRecurrence = resolved.parsedRecurrence;
          resolvedScheduleType = resolved.scheduleType;
        } catch (err: any) {
          const errorMessage = err?.message?.includes('recurrenceRule') ? 'Invalid recurrenceRule value' : 'Invalid scheduleType value';
          results.push({ input, status: 'error', errorMessage });
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
          importance: importance || 'normal',
          scheduleType: resolvedScheduleType,
        };
        if (parsedRecurrence) task.recurrenceRule = JSON.stringify(parsedRecurrence);

        const conflicts = findConflictingTasks(user.tasks || [], task, { boundaryConflict: effectiveBoundary });

        try {
          await dbService.addTask(user.id, task, effectiveBoundary, true);
          broadcastTaskChange('created', task, user.id);

          if (conflicts.length > 0) {
            await logUserEvent(user.id, 'taskConflict', `Batch created task with conflict ${task.name}`, { id: task.id, startTime: task.startTime, endTime: task.endTime });
          } else {
            await logUserEvent(user.id, 'taskCreated', `Batch created task ${task.name}`, { id: task.id, startTime: task.startTime, endTime: task.endTime });
          }

          let createdChildren = 0, conflictChildren = 0, errorChildren = 0;
          const createdIds: string[] = [task.id];
          const instanceConflicts: any[] = [];

          if (parsedRecurrence) {
            const generated = generateRecurrenceInstances(task, parsedRecurrence);
            for (const inst of generated) {
              try {
                const instConf = findConflictingTasks(user.tasks || [], inst, { boundaryConflict: effectiveBoundary });
                if (instConf.length > 0) {
                  instanceConflicts.push({
                    instance: { id: inst.id, startTime: inst.startTime, endTime: inst.endTime },
                    conflicts: instConf.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime }))
                  });
                  await logUserEvent(user.id, 'taskConflict', `Batch created recurrence instance with conflict ${inst.name}`, { parentId: task.id, instanceStart: inst.startTime, instanceEnd: inst.endTime });
                } else {
                  await logUserEvent(user.id, 'taskCreated', `Batch created recurrence instance ${inst.name}`, { id: inst.id, parentTaskId: inst.parentTaskId, startTime: inst.startTime, endTime: inst.endTime });
                }

                await dbService.addTask(user.id, inst, effectiveBoundary, true);
                createdChildren++;
                createdIds.push(inst.id);
                broadcastTaskChange('created', inst, user.id);
              } catch (e: any) {
                errorChildren++;
                await logUserEvent(user.id, 'taskError', `Error creating batch instance for ${task.name}`, { parentId: task.id, error: e?.message });
              }
            }
            results.push({
              input,
              status: 'created',
              task,
              recurrenceSummary: buildRecurrenceSummary(parsedRecurrence, createdChildren, 0, errorChildren),
              conflictWarning: (conflicts.length > 0 || instanceConflicts.length > 0) ? {
                message: 'Task created with time conflicts',
                conflicts: conflicts.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime })),
                instanceConflicts
              } : undefined
            });
          } else {
            results.push({
              input,
              status: 'created',
              task,
              conflictWarning: conflicts.length > 0 ? {
                message: 'Task created with time conflicts',
                conflicts: conflicts.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime }))
              } : undefined
            });
          }
          // 增量刷新缓存：合并新建 id
          await dbService.refreshUserTasksIncremental(user, { addedIds: createdIds });
          created++;
        } catch (e: any) {
          errors++;
          results.push({ input, status: 'error', errorMessage: e?.message || 'unknown error' });
          await logUserEvent(user.id, 'taskError', `Error creating task ${name}`, { startTime, endTime, error: e?.message });
        }
      }
      return res.status(200).json({
        results,
        summary: { total: tasks.length, created, conflicts: 0, errors } // conflicts count is 0 because we created them
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

  // 获取当前周信息（包含全局偏移与用户偏移）
  router.get('/settings/week', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      // 计算原始周次（不含任何偏移）
      const academicWeekOffset = parseInt(process.env.ACADEMIC_WEEK_OFFSET || '0', 10) || 0;
      const academicYearStartMonth = parseInt(process.env.ACADEMIC_YEAR_START_MONTH || '9', 10) || 9;
      const academicYearStartDay = parseInt(process.env.ACADEMIC_YEAR_START_DAY || '1', 10) || 1;

      const currentDate = new Date();
      const year = currentDate.getFullYear();
      let academicYearStart: Date;
      if (currentDate.getMonth() >= academicYearStartMonth - 1) {
        academicYearStart = new Date(year, academicYearStartMonth - 1, academicYearStartDay);
      } else {
        academicYearStart = new Date(year - 1, academicYearStartMonth - 1, academicYearStartDay);
      }

      const timeDiff = currentDate.getTime() - academicYearStart.getTime();
      const dayDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
      const rawWeekNumber = Math.ceil((dayDiff + 1) / 7);

      const globalWeekOffset = academicWeekOffset;
      const userWeekOffset = user && typeof user.weekOffset === 'number' ? user.weekOffset : 0;

      const effectiveWeek = Math.max(1, rawWeekNumber + globalWeekOffset + (userWeekOffset || 0));

      return res.status(200).json({ rawWeekNumber, globalWeekOffset, userWeekOffset: userWeekOffset || 0, effectiveWeek });
    } catch (error) {
      logger.error('Failed to get week info:', error);
      return res.status(500).json({ error: 'Failed to get week info' });
    }
  });

  // 更新用户级周数偏移（可通过提供currentWeek来设置当前周数）
  router.post('/settings/week', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const { currentWeek, userWeekOffset } = req.body || {};

      const academicWeekOffset = parseInt(process.env.ACADEMIC_WEEK_OFFSET || '0', 10) || 0;
      const academicYearStartMonth = parseInt(process.env.ACADEMIC_YEAR_START_MONTH || '9', 10) || 9;
      const academicYearStartDay = parseInt(process.env.ACADEMIC_YEAR_START_DAY || '1', 10) || 1;

      const currentDate = new Date();
      const year = currentDate.getFullYear();
      let academicYearStart: Date;
      if (currentDate.getMonth() >= academicYearStartMonth - 1) {
        academicYearStart = new Date(year, academicYearStartMonth - 1, academicYearStartDay);
      } else {
        academicYearStart = new Date(year - 1, academicYearStartMonth - 1, academicYearStartDay);
      }
      const timeDiff = currentDate.getTime() - academicYearStart.getTime();
      const dayDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
      const rawWeekNumber = Math.ceil((dayDiff + 1) / 7);

      let newUserOffset = typeof userWeekOffset === 'number' ? userWeekOffset : undefined;
      if (typeof currentWeek === 'number') {
        // 计算需要设置的 user offset，使得 raw + global + userOffset === currentWeek
        newUserOffset = currentWeek - (rawWeekNumber + academicWeekOffset);
      }

      if (typeof newUserOffset !== 'number' || isNaN(newUserOffset)) {
        return res.status(400).json({ error: 'Either currentWeek (number) or userWeekOffset (number) required' });
      }

      user.weekOffset = Math.trunc(newUserOffset);
      await dbService.updateUser(user);

      // 返回更新后的信息
      const effectiveWeek = Math.max(1, rawWeekNumber + academicWeekOffset + (user.weekOffset || 0));
      return res.status(200).json({ rawWeekNumber, globalWeekOffset: academicWeekOffset, userWeekOffset: (user.weekOffset || 0), effectiveWeek });
    } catch (error) {
      logger.error('Failed to set week info:', error);
      return res.status(500).json({ error: 'Failed to set week info' });
    }
  });

  // 更新任务（部分字段 + 冲突检测）
  router.put('/tasks/:id', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const taskId = req.params.id;
      const existing = user.tasks.find(t => t.id === taskId);
      if (!existing) return res.status(404).json({ error: 'task not found' });
      const { name, description, startTime, endTime, dueDate, location, completed, boundaryConflict, importance, recurrenceRule: recurrenceRuleInput, scheduleType: scheduleTypeInput } = req.body || {};
      const recurrenceSource = recurrenceRuleInput !== undefined ? recurrenceRuleInput : existing.recurrenceRule;
      let parsedRecurrence: RecurrenceRule | undefined;
      let resolvedScheduleType: ScheduleType;
      try {
        const resolved = resolveScheduleType({ explicit: scheduleTypeInput, recurrence: recurrenceSource, fallback: existing.scheduleType || 'single' });
        parsedRecurrence = resolved.parsedRecurrence;
        resolvedScheduleType = resolved.scheduleType;
      } catch (err: any) {
        const msg = err?.message?.includes('recurrenceRule') ? 'Invalid recurrenceRule value' : 'Invalid scheduleType value';
        return res.status(400).json({ error: msg });
      }
      const recurrenceString = recurrenceRuleInput !== undefined
        ? (parsedRecurrence ? JSON.stringify(parsedRecurrence) : undefined)
        : existing.recurrenceRule;

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
        importance: importance !== undefined ? importance : existing.importance,
        scheduleType: resolvedScheduleType,
        recurrenceRule: recurrenceString,
      };
      try {
        const effectiveBoundary = boundaryConflict !== undefined ? !!boundaryConflict : !!user.conflictBoundaryInclusive;

        // 冲突检测
        const conflicts = findConflictingTasks(user.tasks.filter(t => t.id !== updated.id), updated, { boundaryConflict: effectiveBoundary });

        await dbService.updateTask(updated, effectiveBoundary, true);
        broadcastTaskChange('updated', updated, user.id);

        if (conflicts.length > 0) {
          await logUserEvent(user.id, 'taskUpdated', `Updated task with conflict ${updated.name}`, { id: updated.id, changes: { name, description, startTime, endTime, dueDate, location, completed, importance }, conflicts: conflicts.map(c => c.id) });
        } else {
          await logUserEvent(user.id, 'taskUpdated', `Updated task ${updated.name}`, { id: updated.id, changes: { name, description, startTime, endTime, dueDate, location, completed, importance } });
        }

        if (completed === true && !existing.completed) {
          broadcastTaskChange('completed', updated, user.id);
          await logUserEvent(user.id, 'taskCompleted', `Completed task ${updated.name}`, { id: updated.id });
        }
        // 增量刷新缓存：仅合并被更新的任务
        await dbService.refreshUserTasksIncremental(user, { updatedIds: [updated.id] });
        return res.status(200).json({
          task: updated,
          conflictWarning: conflicts.length > 0 ? {
            message: 'Task updated with time conflicts',
            conflicts: conflicts.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime }))
          } : undefined
        });
      } catch (e: any) {
        logger.error('Failed to update task:', e);
        return res.status(500).json({ error: 'Failed to update task' });
      }
    } catch (error) {
      logger.error('Unexpected error in PUT /tasks/:id:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 部分更新任务
  router.patch('/tasks/:id', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const taskId = req.params.id;
      const updates = req.body;

      // 过滤掉不允许直接修改的字段
      delete updates.id;
      delete updates.userId;
      delete updates.createdAt;
      delete updates.updatedAt;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No update fields provided' });
      }

      const boundaryConflict = updates.boundaryConflict;
      delete updates.boundaryConflict;

      const existingTask = await dbService.getTaskById(taskId);
      if (!existingTask) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const scheduleTypeExplicit = updates.scheduleType;
      const recurrenceProvided = Object.prototype.hasOwnProperty.call(updates, 'recurrenceRule');
      const recurrenceSource = recurrenceProvided ? updates.recurrenceRule : existingTask.recurrenceRule;
      let parsedRecurrence: RecurrenceRule | undefined;
      let resolvedScheduleType: ScheduleType;
      try {
        const resolved = resolveScheduleType({
          explicit: scheduleTypeExplicit,
          recurrence: recurrenceSource,
          fallback: existingTask.scheduleType || 'single'
        });
        parsedRecurrence = resolved.parsedRecurrence;
        resolvedScheduleType = resolved.scheduleType;
      } catch (err: any) {
        const msg = err?.message?.includes('recurrenceRule') ? 'Invalid recurrenceRule value' : 'Invalid scheduleType value';
        return res.status(400).json({ error: msg });
      }

      if (recurrenceProvided) {
        updates.recurrenceRule = parsedRecurrence ? JSON.stringify(parsedRecurrence) : null;
      }
      if (scheduleTypeExplicit !== undefined || recurrenceProvided) {
        updates.scheduleType = resolvedScheduleType;
      }

      const wasCompleted = existingTask.completed;

      const updatedTask = await dbService.patchTask(user.id, taskId, updates, boundaryConflict, true);

      // 冲突检测 (需要构建完整的对象)
      const fullUpdatedTask = { ...existingTask, ...updates, id: taskId };
      const effectiveBoundary = boundaryConflict !== undefined ? !!boundaryConflict : !!user.conflictBoundaryInclusive;
      let conflicts: any[] = [];
      if (updates.startTime || updates.endTime) {
        conflicts = findConflictingTasks(user.tasks.filter(t => t.id !== taskId), fullUpdatedTask, { boundaryConflict: effectiveBoundary });
      }

      broadcastTaskChange('updated', updatedTask, user.id);

      if (conflicts.length > 0) {
        await logUserEvent(user.id, 'taskUpdated', `Patched task with conflict ${updatedTask.name}`, { id: updatedTask.id, changes: updates, conflicts: conflicts.map(c => c.id) });
      } else {
        await logUserEvent(user.id, 'taskUpdated', `Patched task ${updatedTask.name}`, { id: updatedTask.id, changes: updates });
      }

      if (updates.completed === true && !wasCompleted) {
        broadcastTaskChange('completed', updatedTask, user.id);
        await logUserEvent(user.id, 'taskCompleted', `Completed task ${updatedTask.name}`, { id: updatedTask.id });
      }

      await dbService.refreshUserTasksIncremental(user, { updatedIds: [taskId] });

      const response: any = { ...updatedTask };
      if (conflicts.length > 0) {
        response.conflictWarning = {
          message: 'Task patched with time conflicts',
          conflicts: conflicts.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime }))
        };
      }
      return res.status(200).json(response);
    } catch (error: any) {
      logger.error('Patch task failed:', error);
      return res.status(500).json({ error: 'Failed to patch task' });
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
          await logUserEvent(user.id, 'taskDeleted', `Deleted task ${deletedTask.name}`, { id: deletedTask.id });
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
          await logUserEvent(user.id, 'taskDeleted', `Cascade deleted task ${del.name}`, { id: del.id, parentId: del.parentTaskId || null });
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

      const parsedCompleted = typeof completed === 'string' ? (completed.toLowerCase() === 'true') : undefined;
      const parsedOrder = (order && (order as string).toLowerCase() === 'desc') ? 'desc' : 'asc';
      const opts: { start?: string; end?: string; q?: string; completed?: boolean; limit: number; offset: number; sortBy?: string; order?: 'asc' | 'desc' } = { start: start as string | undefined, end: end as string | undefined, q: q as string | undefined, completed: parsedCompleted as boolean | undefined, limit: limNum, offset: offNum, sortBy: sortBy as string | undefined, order: parsedOrder };
      const { tasks, total } = await dbService.getTasksPage(user.id, opts);
      return res.status(200).json({ tasks, total, limit: limNum, offset: offNum, sortBy: opts.sortBy || 'startTime', order: opts.order || 'asc' });
    } catch (error) {
      logger.error('Failed to list tasks:', error);
      return res.status(500).json({ error: 'Failed to list tasks' });
    }
  });

  // 列出所有父级日程（即带有 recurrenceRule 的根任务）及其子实例
  router.get('/tasks/parents', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      // 拉取所有任务并筛选父任务
      const { tasks } = await dbService.getTasksPage(user.id, { limit: 1000 });
      const parents = tasks.filter(t => t.recurrenceRule && !t.parentTaskId);

      const result: any[] = [];
      for (const p of parents) {
        try {
          const { occurrences, total } = await dbService.getOccurrencesPage(user.id, p.id, { limit: 1000 });
          result.push({ parentTask: p, occurrences, total });
        } catch (e) {
          // 如果某个父任务查询失败，仍继续处理其它任务
          result.push({ parentTask: p, occurrences: [], total: 0, error: (e as Error).message });
        }
      }

      return res.status(200).json({ parents: result });
    } catch (error) {
      logger.error('Failed to list parent tasks:', error);
      return res.status(500).json({ error: 'Failed to list parent tasks' });
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
      const parsedOrder = (order && (order as string).toLowerCase() === 'desc') ? 'desc' : 'asc';
      const { occurrences, total } = await dbService.getOccurrencesPage(user.id, rootId, { limit: limNum, offset: offNum, sortBy: sortBy as string, order: parsedOrder });
      return res.status(200).json({ rootTask: root, occurrences, total, limit: limNum, offset: offNum, sortBy: sortBy || 'startTime', order: order || 'asc' });
    } catch (e) {
      logger.error('Fetch occurrences failed', e);
      return res.status(500).json({ error: 'Failed to fetch occurrences' });
    }
  });  // 获取当前用户的日程队列
  router.get('/schedule-queue', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      if (!user?.id) return res.status(401).json({ error: '未登录或无用户信息' });
      const queue = await dbService.getScheduleQueueByUser(user.id);
      res.json({ queue });
    } catch (err: any) {
      logger.error('获取日程队列失败:', err);
      res.status(500).json({ error: '获取队列失败' });
    }
  });

  // Approve a queued schedule request
  router.post('/schedule-queue/:id/approve', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const id = req.params.id as string;
      const row = await dbService.getScheduleQueueById(id);
      if (!row) return res.status(404).json({ error: 'Queue item not found' });
      if (row.userId !== user.id) return res.status(403).json({ error: 'Not your queue item' });

      const raw = row.rawRequest;
      const parsed = JSON.parse(raw);
      const args = parsed.args || parsed;

      // Call add_schedule with internal approval flag
      const result = await mcpTools.add_schedule.execute({ ...args, _internal_approve: true }, user);

      // Remove queue item (approved) and return latest queue
      try {
        await dbService.deleteScheduleQueueItem(id);
      } catch (e) {
        logger.warn('Failed to delete schedule queue item after approval, will fallback to marking approved', e);
        await dbService.updateScheduleQueueStatus(id, 'approved');
      }

      const queue = await dbService.getScheduleQueueByUser(user.id);
      res.json({ result, queue });
    } catch (err: any) {
      logger.error('Approving schedule queue item failed:', err);
      res.status(500).json({ error: 'Approve failed' });
    }
  });

  // Reject a queued schedule request
  router.post('/schedule-queue/:id/reject', authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user as User;
      const id = req.params.id as string;
      const row = await dbService.getScheduleQueueById(id);
      if (!row) return res.status(404).json({ error: 'Queue item not found' });
      if (row.userId !== user.id) return res.status(403).json({ error: 'Not your queue item' });

      // Remove rejected item from queue and return updated queue
      try {
        await dbService.deleteScheduleQueueItem(id);
      } catch (e) {
        logger.warn('Failed to delete schedule queue item after rejection, will fallback to marking rejected', e);
        await dbService.updateScheduleQueueStatus(id, 'rejected');
      }
      await logUserEvent(user.id, 'external_schedule_rejected', `已拒绝外部日程请求`, { queueId: id });
      const queue = await dbService.getScheduleQueueByUser(user.id);
      res.json({ ok: true, queue });
    } catch (err: any) {
      logger.error('Rejecting schedule queue item failed:', err);
      res.status(500).json({ error: 'Reject failed' });
    }
  });

  return router;
}