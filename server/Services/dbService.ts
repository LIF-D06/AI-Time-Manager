import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { User, Task } from '../index';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../Utils/logger.js';
import { assertNoConflict } from './scheduleConflict';

class DatabaseService {

    private db: Database | null = null;
    private onLogAdded: ((userId: string, log: any) => void) | null = null;

    public setLogListener(listener: (userId: string, log: any) => void) {
        this.onLogAdded = listener;
    }
    
    async initialize() {
        try {
            // 使用 Azure 的临时存储路径或当前目录
            const dbPath = process.env.WEBSITE_INSTANCE_ID ? 
                '/home/data/users.db' : './users.db';
            
            logger.info(`Initializing database at path: ${dbPath}`);
            
            // 打开或创建数据库
            this.db = await open({
                filename: dbPath,
                driver: sqlite3.Database
            });
            
            // 创建用户表
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    XJTLUaccount TEXT,
                    XJTLUPassword TEXT,
                    passwordHash TEXT,
                    JWTtoken TEXT,
                    MStoken TEXT,
                    MSbinded BOOLEAN DEFAULT 0,
                    ebridgeBinded BOOLEAN DEFAULT 0,
                    timetableUrl TEXT DEFAULT '',
                    timetableFetchLevel INTEGER DEFAULT 0,
                    mailReadingSpan INTEGER DEFAULT 30,
                    conflictBoundaryInclusive BOOLEAN DEFAULT 0,
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 创建日程队列表
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS schedule_queue (
                    id TEXT PRIMARY KEY,
                    userId TEXT NOT NULL,
                    rawRequest TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `);
            
            // 如果表已存在但缺少XJTLUaccount字段，则添加该字段
            try {
                await this.db.exec(`ALTER TABLE users ADD COLUMN XJTLUaccount TEXT;`);
            } catch (e) {
                // 如果字段已存在，忽略错误
                logger.info('XJTLUaccount column already exists or error adding it:', (e as Error).message);
            }
            
            // 如果表已存在但缺少timetableUrl字段，则添加该字段
            try {
                await this.db.exec(`ALTER TABLE users ADD COLUMN timetableUrl TEXT DEFAULT '';`);
            } catch (e) {
                // 如果字段已存在，忽略错误
                logger.info('timetableUrl column already exists or error adding it:', (e as Error).message);
            }
            
            // 如果表已存在但缺少timetableFetchLevel字段，则添加该字段
            try {
                await this.db.exec(`ALTER TABLE users ADD COLUMN timetableFetchLevel INTEGER DEFAULT 0;`);
            } catch (e) {
                // 如果字段已存在，忽略错误
                logger.info('timetableFetchLevel column already exists or error adding it:', (e as Error).message);
            }
            
            // 如果表已存在但缺少mailReadingSpan字段，则添加该字段
            try {
                await this.db.exec(`ALTER TABLE users ADD COLUMN mailReadingSpan INTEGER DEFAULT 30;`);
            } catch (e) {
                // 如果字段已存在，忽略错误
                logger.info('mailReadingSpan column already exists or error adding it:', (e as Error).message);
            }

            // 如果缺少 conflictBoundaryInclusive 字段则添加
            try {
                await this.db.exec(`ALTER TABLE users ADD COLUMN conflictBoundaryInclusive BOOLEAN DEFAULT 0;`);
            } catch (e) {
                logger.info('conflictBoundaryInclusive column already exists or error adding it:', (e as Error).message);
            }

            // 如果缺少 weekOffset 字段则添加（用户可配置的周数偏移量）
            try {
                await this.db.exec(`ALTER TABLE users ADD COLUMN weekOffset INTEGER DEFAULT 0;`);
            } catch (e) {
                logger.info('weekOffset column already exists or error adding it:', (e as Error).message);
            }

            // tasks 表新增列（迁移场景）
            try { await this.db.exec(`ALTER TABLE tasks ADD COLUMN recurrenceRule TEXT;`); } catch (e) { logger.info('recurrenceRule column exists or error:', (e as Error).message); }
            try { await this.db.exec(`ALTER TABLE tasks ADD COLUMN parentTaskId TEXT;`); } catch (e) { logger.info('parentTaskId column exists or error:', (e as Error).message); }
            try { await this.db.exec(`ALTER TABLE tasks ADD COLUMN importance TEXT DEFAULT 'normal';`); } catch (e) { logger.info('importance column exists or error:', (e as Error).message); }
            try { await this.db.exec(`ALTER TABLE tasks ADD COLUMN scheduleType TEXT DEFAULT 'single';`); } catch (e) { logger.info('scheduleType column exists or error:', (e as Error).message); }
            try {
                await this.db.run(`UPDATE tasks SET scheduleType = 'recurring_daily' WHERE recurrenceRule LIKE '%"freq":"daily"%' AND (scheduleType IS NULL OR scheduleType = '' OR scheduleType = 'single')`);
                await this.db.run(`UPDATE tasks SET scheduleType = 'recurring_weekly' WHERE recurrenceRule LIKE '%"freq":"weekly"%' AND (scheduleType IS NULL OR scheduleType = '' OR scheduleType = 'single')`);
                await this.db.run(`UPDATE tasks SET scheduleType = 'recurring_weekly_by_week_number' WHERE recurrenceRule LIKE '%"freq":"weeklyByWeekNumber"%' AND (scheduleType IS NULL OR scheduleType = '' OR scheduleType = 'single')`);
                await this.db.run(`UPDATE tasks SET scheduleType = 'recurring_daily_on_days' WHERE recurrenceRule LIKE '%"freq":"dailyOnDays"%' AND (scheduleType IS NULL OR scheduleType = '' OR scheduleType = 'single')`);
            } catch (e) {
                logger.info('scheduleType backfill skipped or failed:', (e as Error).message);
            }
            
            // 创建任务表
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    userId TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    dueDate TEXT,
                    startTime TEXT,
                    endTime TEXT,
                    location TEXT,
                    completed BOOLEAN DEFAULT 0,
                    pushedToMSTodo BOOLEAN DEFAULT 0,
                    body TEXT,
                    attendees TEXT,
                    recurrenceRule TEXT,
                    parentTaskId TEXT,
                    importance TEXT DEFAULT 'normal',
                    scheduleType TEXT DEFAULT 'single',
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
                );
            `);

            // 创建用户日志表
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS user_logs (
                    id TEXT PRIMARY KEY,
                    userId TEXT NOT NULL,
                    time DATETIME DEFAULT CURRENT_TIMESTAMP,
                    type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    payload TEXT,
                    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
                );
            `);
            
            logger.success('Database initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize database:', error);
            throw error;
        }
    }

    async addUserLog(userId: string, type: string, message: string, payload?: any): Promise<{ id: string; time: string; type: string; message: string; payload?: any }> {
        if (!this.db) throw new Error('Database not initialized');
        const id = uuidv4();
        const payloadStr = payload !== undefined ? JSON.stringify(payload) : null;
        await this.db.run(
            `INSERT INTO user_logs (id, userId, type, message, payload) VALUES (?, ?, ?, ?, ?)`,
            [id, userId, type, message, payloadStr]
        );
        const row: any = await this.db.get(`SELECT * FROM user_logs WHERE id = ?`, [id]);
        const logEntry = { id: row.id, time: row.time, type: row.type, message: row.message, payload: row.payload ? JSON.parse(row.payload) : undefined };
        
        // Notify listener
        if (this.onLogAdded) {
            this.onLogAdded(userId, logEntry);
        }
        
        return logEntry;
    }

    async getUserLogsPage(userId: string, opts?: { limit?: number; offset?: number; since?: string; until?: string; type?: string }): Promise<{ logs: Array<{ id: string; time: string; type: string; message: string; payload?: any }>; total: number }> {
        if (!this.db) throw new Error('Database not initialized');
        const where: string[] = ['userId = ?'];
        const params: any[] = [userId];
        if (opts?.since) { where.push('time >= ?'); params.push(opts.since); }
        if (opts?.until) { where.push('time <= ?'); params.push(opts.until); }
        if (opts?.type) { where.push('type = ?'); params.push(opts.type); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit = Math.max(1, Math.min(500, opts?.limit || 50));
        const offset = Math.max(0, opts?.offset || 0);
        const countRow: any = await this.db.get(`SELECT COUNT(*) as cnt FROM user_logs ${whereSql}`, params);
        const total = countRow ? (countRow.cnt || 0) : 0;
        const rows = await this.db.all(`SELECT * FROM user_logs ${whereSql} ORDER BY time DESC LIMIT ? OFFSET ?`, params.concat([limit, offset]));
        const logs = rows.map((r: any) => ({ id: r.id, time: r.time, type: r.type, message: r.message, payload: r.payload ? JSON.parse(r.payload) : undefined }));
        return { logs, total };
    }
    
    async addUser(user: User): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        
          await this.db.run(
          `INSERT INTO users 
           (id, email, name, XJTLUaccount, XJTLUPassword, passwordHash, JWTtoken, MStoken, MSbinded, ebridgeBinded, timetableUrl, timetableFetchLevel, mailReadingSpan, conflictBoundaryInclusive, weekOffset) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [user.id, user.email, user.name, user.XJTLUaccount, user.XJTLUPassword, user.passwordHash, 
           user.JWTtoken, user.MStoken, user.MSbinded ? 1 : 0, user.ebridgeBinded ? 1 : 0, user.timetableUrl, user.timetableFetchLevel || 0, user.mailReadingSpan ?? 30, user.conflictBoundaryInclusive ? 1 : 0, user.weekOffset || 0]
       );
        
        // 保存用户的任务
        for (const task of user.tasks || []) {
            await this.addTask(user.id, task);
        }
    }
    
    async updateUser(user: User): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        
        await this.db.run(
            `UPDATE users 
             SET email = ?, name = ?, XJTLUaccount = ?, XJTLUPassword = ?, passwordHash = ?, 
                 JWTtoken = ?, MStoken = ?, MSbinded = ?, ebridgeBinded = ?, timetableUrl = ?, timetableFetchLevel = ?, mailReadingSpan = ?, conflictBoundaryInclusive = ?, weekOffset = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [user.email, user.name, user.XJTLUaccount, user.XJTLUPassword, user.passwordHash, 
             user.JWTtoken, user.MStoken, user.MSbinded ? 1 : 0, user.ebridgeBinded ? 1 : 0, user.timetableUrl, user.timetableFetchLevel || 0, user.mailReadingSpan ?? 30, user.conflictBoundaryInclusive ? 1 : 0, user.weekOffset || 0, user.id]
        );
    }
    
    async getUserById(id: string): Promise<User | null> {
        if (!this.db) throw new Error('Database not initialized');
        
        const row: any = await this.db.get(
            'SELECT * FROM users WHERE id = ?',
            [id]
        );

        if (!row) return null;

        // 获取用户的任务
        const tasks = await this.getTasksByUserId(id);

        return this.mapRowToUser(row, tasks);
    }
    
    async getUserByEmail(email: string): Promise<User | null> {
        if (!this.db) throw new Error('Database not initialized');
        
        const row: any = await this.db.get(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (!row) return null;

        // 获取用户的任务
        const tasks = await this.getTasksByUserId(row.id);

        return this.mapRowToUser(row, tasks);
    }
    
    async getAllUsers(): Promise<User[]> {
        if (!this.db) throw new Error('Database not initialized');
        
        const rows: any[] = await this.db.all('SELECT * FROM users');
        const users: User[] = [];
        
        for (const row of rows) {
            const tasks = await this.getTasksByUserId(row.id);
            users.push(this.mapRowToUser(row, tasks));
        }
        
        return users;
    }
    
    async addTask(userId: string, task: Task, boundaryConflict?: boolean, allowConflict: boolean = true): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        // 冲突检测：在写入前基于当前用户的任务进行时段冲突检查
        const existing = await this.getTasksByUserId(userId);
        if (!allowConflict) {
            assertNoConflict(existing, task, { boundaryConflict: boundaryConflict ?? false });
        }
        // 规范化时间字段为 UTC ISO 字符串，避免不同时区/格式导致的字符串比较错误
        try {
            if (task.startTime) task.startTime = new Date(task.startTime).toISOString();
        } catch (e) {}
        try {
            if (task.endTime) task.endTime = new Date(task.endTime).toISOString();
        } catch (e) {}
        try {
            if (task.dueDate) task.dueDate = new Date(task.dueDate).toISOString();
        } catch (e) {}

        await this.db.run(
            `INSERT INTO tasks 
             (id, userId, name, description, dueDate, startTime, endTime, 
              location, completed, pushedToMSTodo, body, attendees, recurrenceRule, parentTaskId, importance, scheduleType) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [task.id, userId, task.name, task.description, task.dueDate, 
             task.startTime, task.endTime, task.location, task.completed ? 1 : 0, 
             task.pushedToMSTodo ? 1 : 0, task.body, task.attendees ? JSON.stringify(task.attendees) : null, task.recurrenceRule || null, task.parentTaskId || null, task.importance || 'normal', task.scheduleType || 'single']
        );
        
        await this.addUserLog(userId, 'task_created', `Created task ${task.name}`, { taskId: task.id, name: task.name });
    }
    
    async updateTask(task: Task, boundaryConflict?: boolean, allowConflict: boolean = false): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        // 在更新任务前执行冲突检测：需要找出该任务所属用户的所有其他任务
        const row = await this.db.get('SELECT userId FROM tasks WHERE id = ?', [task.id]);
        if (row && row.userId) {
            const existing = await this.getTasksByUserId(row.userId);
            // 排除自身后进行冲突检测
            const others = existing.filter(t => t.id !== task.id);
            if (!allowConflict) {
                assertNoConflict(others, task, { boundaryConflict: boundaryConflict ?? false });
            }
        }
        // 规范化时间字段为 UTC ISO
        try { if (task.startTime) task.startTime = new Date(task.startTime).toISOString(); } catch (e) {}
        try { if (task.endTime) task.endTime = new Date(task.endTime).toISOString(); } catch (e) {}
        try { if (task.dueDate) task.dueDate = new Date(task.dueDate).toISOString(); } catch (e) {}

        await this.db.run(
            `UPDATE tasks 
             SET name = ?, description = ?, dueDate = ?, startTime = ?, endTime = ?, 
                 location = ?, completed = ?, pushedToMSTodo = ?, body = ?, attendees = ?, recurrenceRule = ?, parentTaskId = ?, importance = ?, scheduleType = ?,
                 updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [task.name, task.description, task.dueDate, task.startTime, task.endTime, 
             task.location, task.completed ? 1 : 0, task.pushedToMSTodo ? 1 : 0, 
             task.body, task.attendees ? JSON.stringify(task.attendees) : null, task.recurrenceRule || null, task.parentTaskId || null, task.importance || 'normal', task.scheduleType || 'single', task.id]
        );
    }

    async patchTask(userId: string, taskId: string, updates: Partial<Task>, boundaryConflict?: boolean, allowConflict: boolean = false): Promise<Task> {
        if (!this.db) throw new Error('Database not initialized');
        const existingTask = await this.getTaskById(taskId);
        if (!existingTask) throw new Error('Task not found');

        const updatedTask = { ...existingTask, ...updates, id: taskId };

        // 如果时间变更，执行冲突检测
        if (updates.startTime || updates.endTime) {
            const allTasks = await this.getTasksByUserId(userId);
            const otherTasks = allTasks.filter(t => t.id !== taskId);
            if (!allowConflict) {
                assertNoConflict(otherTasks, updatedTask, { boundaryConflict: boundaryConflict ?? false });
            }
        }

        const fields = Object.keys(updates).filter(k => k !== 'id');
        if (fields.length === 0) return existingTask;

        // 规范化时间字段（若在更新中出现）以 UTC ISO 格式写入
        if (updates.startTime) {
            try { updates.startTime = new Date(updates.startTime as string).toISOString(); } catch (e) {}
        }
        if (updates.endTime) {
            try { updates.endTime = new Date(updates.endTime as string).toISOString(); } catch (e) {}
        }
        if (updates.dueDate) {
            try { updates.dueDate = new Date(updates.dueDate as string).toISOString(); } catch (e) {}
        }

        const setClauses = fields.map(f => `${f} = ?`).join(', ');
        const values = fields.map(f => {
            const key = f as keyof typeof updates;
            let value = updates[key];
            if (typeof value === 'boolean') return value ? 1 : 0;
            if (typeof value === 'object' && value !== null) return JSON.stringify(value);
            return value;
        });

        const sql = `UPDATE tasks SET ${setClauses}, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?`;
        await this.db.run(sql, [...values, taskId, userId]);

        await this.addUserLog(userId, 'task_updated', `Updated task ${taskId}`, { taskId, updates });

        return await this.getTaskById(taskId) as Task;
    }
    
    async getTasksByUserId(userId: string): Promise<Task[]> {
        if (!this.db) throw new Error('Database not initialized');
        
        const rows = await this.db.all(
            'SELECT * FROM tasks WHERE userId = ?',
            [userId]
        );
        
        return rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            dueDate: row.dueDate,
            startTime: row.startTime,
            endTime: row.endTime,
            location: row.location,
            completed: row.completed === 1,
            pushedToMSTodo: row.pushedToMSTodo === 1,
            body: row.body,
            attendees: row.attendees ? JSON.parse(row.attendees) : undefined,
            recurrenceRule: row.recurrenceRule || undefined,
            parentTaskId: row.parentTaskId || undefined,
            importance: row.importance || 'normal',
            scheduleType: row.scheduleType || 'single'
        }));
    }

    // 分页 / 过滤查询：用于高性能列出任务
    async getTasksPage(userId: string, opts?: {
        start?: string;
        end?: string;
        q?: string;
        completed?: boolean;
        limit?: number;
        offset?: number;
        sortBy?: string;
        order?: 'asc' | 'desc';
    }): Promise<{ tasks: Task[]; total: number }> {
        if (!this.db) throw new Error('Database not initialized');
        const where: string[] = ['userId = ?'];
        const params: any[] = [userId];
        if (opts?.start) {
            where.push('endTime >= ?');
            params.push(opts.start);
        }
        if (opts?.end) {
            where.push('startTime <= ?');
            params.push(opts.end);
        }
        if (typeof opts?.completed === 'boolean') {
            where.push('completed = ?');
            params.push(opts.completed ? 1 : 0);
        }
        if (opts?.q) {
            const like = `%${opts.q.toLowerCase()}%`;
            where.push('(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(location) LIKE ?)');
            params.push(like, like, like);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const sortField = ['startTime', 'dueDate', 'name', 'endTime'].includes(opts?.sortBy || '') ? opts!.sortBy : 'startTime';
        const order = opts?.order === 'desc' ? 'DESC' : 'ASC';
        const limit = Math.max(1, Math.min(500, opts?.limit || 50));
        const offset = Math.max(0, opts?.offset || 0);

        // count
        const countSql = `SELECT COUNT(*) as cnt FROM tasks ${whereSql}`;
        const countRow: any = await this.db.get(countSql, params);
        const total = countRow ? (countRow.cnt || 0) : 0;

        // select with ordering and pagination
        const sql = `SELECT * FROM tasks ${whereSql} ORDER BY ${sortField} ${order} LIMIT ? OFFSET ?`;
        const finalParams = params.concat([limit, offset]);
        const rows = await this.db.all(sql, finalParams);
        const tasks = rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            dueDate: row.dueDate,
            startTime: row.startTime,
            endTime: row.endTime,
            location: row.location,
            completed: row.completed === 1,
            pushedToMSTodo: row.pushedToMSTodo === 1,
            body: row.body,
            attendees: row.attendees ? JSON.parse(row.attendees) : undefined,
            recurrenceRule: row.recurrenceRule || undefined,
            parentTaskId: row.parentTaskId || undefined,
            importance: row.importance || 'normal',
            scheduleType: row.scheduleType || 'single'
        } as Task));

        return { tasks, total };
    }

    // 分页获取某根任务的子实例（occurrences）
    async getOccurrencesPage(userId: string, rootTaskId: string, opts?: { limit?: number; offset?: number; sortBy?: string; order?: 'asc' | 'desc' }): Promise<{ occurrences: Task[]; total: number }> {
        if (!this.db) throw new Error('Database not initialized');
        const where: string[] = ['userId = ?', 'parentTaskId = ?'];
        const params: any[] = [userId, rootTaskId];
        const whereSql = `WHERE ${where.join(' AND ')}`;
        const sortField = ['startTime', 'dueDate', 'name', 'endTime'].includes(opts?.sortBy || '') ? opts!.sortBy : 'startTime';
        const order = opts?.order === 'desc' ? 'DESC' : 'ASC';
        const limit = Math.max(1, Math.min(500, opts?.limit || 50));
        const offset = Math.max(0, opts?.offset || 0);

        const countSql = `SELECT COUNT(*) as cnt FROM tasks ${whereSql}`;
        const countRow: any = await this.db.get(countSql, params);
        const total = countRow ? (countRow.cnt || 0) : 0;

        const sql = `SELECT * FROM tasks ${whereSql} ORDER BY ${sortField} ${order} LIMIT ? OFFSET ?`;
        const rows = await this.db.all(sql, params.concat([limit, offset]));
        const occurrences = rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            dueDate: row.dueDate,
            startTime: row.startTime,
            endTime: row.endTime,
            location: row.location,
            completed: row.completed === 1,
            pushedToMSTodo: row.pushedToMSTodo === 1,
            body: row.body,
            attendees: row.attendees ? JSON.parse(row.attendees) : undefined,
            recurrenceRule: row.recurrenceRule || undefined,
            parentTaskId: row.parentTaskId || undefined,
            importance: row.importance || 'normal',
            scheduleType: row.scheduleType || 'single'
        } as Task));

        return { occurrences, total };
    }

    // 刷新内存中的 user.tasks 缓存
    async refreshUserTasks(user: any): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        if (!user || !user.id) throw new Error('Invalid user');
        const tasks = await this.getTasksByUserId(user.id);
        user.tasks = tasks;
    }

    // 根据指定的 id 列表获取任务
    async getTasksByIds(userId: string, ids: string[]): Promise<Task[]> {
        if (!this.db) throw new Error('Database not initialized');
        if (!ids || ids.length === 0) return [];
        const placeholders = ids.map(() => '?').join(',');
        const sql = `SELECT * FROM tasks WHERE userId = ? AND id IN (${placeholders})`;
        const rows = await this.db.all(sql, [userId, ...ids]);
        return rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            dueDate: row.dueDate,
            startTime: row.startTime,
            endTime: row.endTime,
            location: row.location,
            completed: row.completed === 1,
            pushedToMSTodo: row.pushedToMSTodo === 1,
            body: row.body,
            attendees: row.attendees ? JSON.parse(row.attendees) : undefined,
            recurrenceRule: row.recurrenceRule || undefined,
            parentTaskId: row.parentTaskId || undefined,
            importance: row.importance || 'normal',
            scheduleType: row.scheduleType || 'single'
        } as Task));
    }

    // 增量刷新用户缓存：仅合并新增/更新并移除已删除
    async refreshUserTasksIncremental(user: any, opts?: { addedIds?: string[]; updatedIds?: string[]; deletedIds?: string[] }): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        if (!user || !user.id) throw new Error('Invalid user');
        user.tasks = user.tasks || [];

        // 处理删除：移除缓存中的 deletedIds
        if (opts?.deletedIds && opts.deletedIds.length > 0) {
            const delSet = new Set(opts.deletedIds);
            user.tasks = (user.tasks || []).filter((t: Task) => !delSet.has(t.id));
        }

        // 处理新增/更新：从 DB 中拉取这些 id 的最新记录并合并到缓存
        const fetchIds: string[] = [];
        if (opts?.addedIds) fetchIds.push(...opts.addedIds);
        if (opts?.updatedIds) fetchIds.push(...opts.updatedIds);
        // 去重
        const uniqueFetchIds = Array.from(new Set(fetchIds));
        if (uniqueFetchIds.length > 0) {
            const rows = await this.getTasksByIds(user.id, uniqueFetchIds);
            for (const r of rows) {
                const idx = user.tasks.findIndex((t: Task) => t.id === r.id);
                if (idx >= 0) {
                    user.tasks[idx] = r;
                } else {
                    user.tasks.push(r);
                }
            }
        }
    }

    async getTaskById(id: string): Promise<Task | null> {
        if (!this.db) throw new Error('Database not initialized');
        const row = await this.db.get('SELECT * FROM tasks WHERE id = ?', [id]);
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            dueDate: row.dueDate,
            startTime: row.startTime,
            endTime: row.endTime,
            location: row.location,
            completed: row.completed === 1,
            pushedToMSTodo: row.pushedToMSTodo === 1,
            body: row.body,
            attendees: row.attendees ? JSON.parse(row.attendees) : undefined,
            recurrenceRule: row.recurrenceRule || undefined,
            parentTaskId: row.parentTaskId || undefined,
            importance: row.importance || 'normal',
            scheduleType: row.scheduleType || 'single'
        } as Task;
    }

    async deleteTask(id: string): Promise<boolean> {
        if (!this.db) throw new Error('Database not initialized');
        
        // Get userId for logging before deletion
        const row = await this.db.get('SELECT userId FROM tasks WHERE id = ?', [id]);
        const userId = row ? row.userId : null;

        const result: any = await this.db.run('DELETE FROM tasks WHERE id = ?', [id]);
        const success = (result?.changes || 0) > 0;

        if (success && userId) {
            await this.addUserLog(userId, 'task_deleted', `Deleted task ${id}`, { taskId: id });
        }

        return success;
    }
    
    async deleteTasksByPattern(userId: string, pattern: string): Promise<number> {
        if (!this.db) throw new Error('Database not initialized');
        
        // Get IDs to be deleted for logging
        const rows = await this.db.all('SELECT id FROM tasks WHERE userId = ? AND id LIKE ?', [userId, pattern]);
        const ids = rows.map((r: any) => r.id);
        
        if (ids.length === 0) return 0;

        const result: any = await this.db.run('DELETE FROM tasks WHERE userId = ? AND id LIKE ?', [userId, pattern]);
        const count = result?.changes || 0;

        if (count > 0) {
            await this.addUserLog(userId, 'tasks_deleted_pattern', `Deleted ${count} tasks matching pattern ${pattern}`, { pattern, count, deletedIds: ids });
        }

        return count;
    }
    
    private mapRowToUser(row: any, tasks: Task[]): User {
        return {
            id: row.id,
            email: row.email,
            name: row.name,
            XJTLUaccount: row.XJTLUaccount,
            XJTLUPassword: row.XJTLUPassword,
            passwordHash: row.passwordHash,
            JWTtoken: row.JWTtoken,
            MStoken: row.MStoken,
            MSbinded: row.MSbinded === 1,
            ebridgeBinded: row.ebridgeBinded === 1,
            timetableUrl: row.timetableUrl || '',
            timetableFetchLevel: row.timetableFetchLevel || 0,
            mailReadingSpan: row.mailReadingSpan ?? 30,
            conflictBoundaryInclusive: row.conflictBoundaryInclusive === 1,
            weekOffset: row.weekOffset || 0,
            tasks: tasks,
            emsClient: undefined // 运行时生成，不持久化
        };
    }
                /**
             * 查询指定用户的日程队列
             */
            async getScheduleQueueByUser(userId: string) {
                if (!this.db) throw new Error('DB not initialized');
                const rows = await this.db.all(`SELECT * FROM schedule_queue WHERE userId = ? ORDER BY createdAt DESC`, [userId]);
                return rows;
            }

            async getScheduleQueueById(id: string) {
                if (!this.db) throw new Error('DB not initialized');
                const row: any = await this.db.get(`SELECT * FROM schedule_queue WHERE id = ?`, [id]);
                return row;
            }

            async updateScheduleQueueStatus(id: string, status: string) {
                if (!this.db) throw new Error('DB not initialized');
                await this.db.run(`UPDATE schedule_queue SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [status, id]);
            }

            async deleteScheduleQueueItem(id: string) {
                if (!this.db) throw new Error('DB not initialized');
                await this.db.run(`DELETE FROM schedule_queue WHERE id = ?`, [id]);
            }
        /**
         * 将日程请求加入队列
         * @param userId 用户ID
         * @param rawRequest 原始请求内容（JSON字符串）
         */
        async addScheduleToQueue(userId: string, rawRequest: string) {
            if (!this.db) throw new Error('DB not initialized');
            const id = uuidv4();
            await this.db.run(`
                INSERT INTO schedule_queue (id, userId, rawRequest, status, createdAt, updatedAt)
                VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [id, userId, rawRequest]);
            return id;
        }
    
    async close() {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }
}

export const dbService = new DatabaseService();