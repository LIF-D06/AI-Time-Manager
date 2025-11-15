import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { User, Task } from '../index';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../Utils/logger.js';
import { assertNoConflict } from './scheduleConflict';

class DatabaseService {
    private db: Database | null = null;
    
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

            // tasks 表新增列（迁移场景）
            try { await this.db.exec(`ALTER TABLE tasks ADD COLUMN recurrenceRule TEXT;`); } catch (e) { logger.info('recurrenceRule column exists or error:', (e as Error).message); }
            try { await this.db.exec(`ALTER TABLE tasks ADD COLUMN parentTaskId TEXT;`); } catch (e) { logger.info('parentTaskId column exists or error:', (e as Error).message); }
            
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
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
                );
            `);
            
            logger.success('Database initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize database:', error);
            throw error;
        }
    }
    
    async addUser(user: User): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        
        await this.db.run(
            `INSERT INTO users 
             (id, email, name, XJTLUaccount, XJTLUPassword, passwordHash, JWTtoken, MStoken, MSbinded, ebridgeBinded, timetableUrl, timetableFetchLevel, mailReadingSpan, conflictBoundaryInclusive) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, user.email, user.name, user.XJTLUaccount, user.XJTLUPassword, user.passwordHash, 
             user.JWTtoken, user.MStoken, user.MSbinded ? 1 : 0, user.ebridgeBinded ? 1 : 0, user.timetableUrl, user.timetableFetchLevel || 0, user.mailReadingSpan ?? 30, user.conflictBoundaryInclusive ? 1 : 0]
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
                 JWTtoken = ?, MStoken = ?, MSbinded = ?, ebridgeBinded = ?, timetableUrl = ?, timetableFetchLevel = ?, mailReadingSpan = ?, conflictBoundaryInclusive = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [user.email, user.name, user.XJTLUaccount, user.XJTLUPassword, user.passwordHash, 
             user.JWTtoken, user.MStoken, user.MSbinded ? 1 : 0, user.ebridgeBinded ? 1 : 0, user.timetableUrl, user.timetableFetchLevel || 0, user.mailReadingSpan ?? 30, user.conflictBoundaryInclusive ? 1 : 0, user.id]
        );
    }
    
    async getUserById(id: string): Promise<User | null> {
        if (!this.db) throw new Error('Database not initialized');
        
        const row = await this.db.get(
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
        
        const row = await this.db.get(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        
        if (!row) return null;
        
        // 获取用户的任务
        const tasks = await this.getTasksByUserId((row as any).id);
        
        return this.mapRowToUser(row, tasks);
    }
    
    async getAllUsers(): Promise<User[]> {
        if (!this.db) throw new Error('Database not initialized');
        
        const rows = await this.db.all('SELECT * FROM users');
        const users: User[] = [];
        
        for (const row of rows) {
            const tasks = await this.getTasksByUserId((row as any).id);
            users.push(this.mapRowToUser(row, tasks));
        }
        
        return users;
    }
    
    async addTask(userId: string, task: Task, boundaryConflict?: boolean): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        // 冲突检测：在写入前基于当前用户的任务进行时段冲突检查
        const existing = await this.getTasksByUserId(userId);
        assertNoConflict(existing, task, { boundaryConflict: boundaryConflict ?? false });
        
        await this.db.run(
            `INSERT INTO tasks 
             (id, userId, name, description, dueDate, startTime, endTime, 
              location, completed, pushedToMSTodo, body, attendees, recurrenceRule, parentTaskId) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [task.id, userId, task.name, task.description, task.dueDate, 
             task.startTime, task.endTime, task.location, task.completed ? 1 : 0, 
              task.pushedToMSTodo ? 1 : 0, task.body, task.attendees ? JSON.stringify(task.attendees) : null, task.recurrenceRule || null, task.parentTaskId || null]
        );
    }
    
    async updateTask(task: Task, boundaryConflict?: boolean): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        // 在更新任务前执行冲突检测：需要找出该任务所属用户的所有其他任务
        const row = await this.db.get('SELECT userId FROM tasks WHERE id = ?', [task.id]);
        if (row && row.userId) {
            const existing = await this.getTasksByUserId(row.userId);
            // 排除自身后进行冲突检测
            const others = existing.filter(t => t.id !== task.id);
            assertNoConflict(others, task, { boundaryConflict: boundaryConflict ?? false });
        }
        await this.db.run(
            `UPDATE tasks 
             SET name = ?, description = ?, dueDate = ?, startTime = ?, endTime = ?, 
                 location = ?, completed = ?, pushedToMSTodo = ?, body = ?, attendees = ?, recurrenceRule = ?, parentTaskId = ?, 
                 updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [task.name, task.description, task.dueDate, task.startTime, task.endTime, 
              task.location, task.completed ? 1 : 0, task.pushedToMSTodo ? 1 : 0, 
              task.body, task.attendees ? JSON.stringify(task.attendees) : null, task.recurrenceRule || null, task.parentTaskId || null, task.id]
        );
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
            parentTaskId: row.parentTaskId || undefined
        }));
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
            parentTaskId: row.parentTaskId || undefined
        } as Task;
    }

    async deleteTask(id: string): Promise<boolean> {
        if (!this.db) throw new Error('Database not initialized');
        const result: any = await this.db.run('DELETE FROM tasks WHERE id = ?', [id]);
        return (result?.changes || 0) > 0;
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
            tasks: tasks,
            emsClient: undefined // 运行时生成，不持久化
        };
    }
    
    async close() {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }
}

export const dbService = new DatabaseService();