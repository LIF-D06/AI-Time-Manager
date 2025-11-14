import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { User, Task } from '../index';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../Utils/logger.js';

class DatabaseService {
    private db: Database | null = null;
    
    async initialize() {
        try {
            // 打开或创建数据库
            this.db = await open({
                filename: './users.db',
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
             (id, email, name, XJTLUaccount, XJTLUPassword, passwordHash, JWTtoken, MStoken, MSbinded, ebridgeBinded, timetableUrl) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, user.email, user.name, user.XJTLUaccount, user.XJTLUPassword, user.passwordHash, 
             user.JWTtoken, user.MStoken, user.MSbinded ? 1 : 0, user.ebridgeBinded ? 1 : 0, user.timetableUrl]
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
                 JWTtoken = ?, MStoken = ?, MSbinded = ?, ebridgeBinded = ?, timetableUrl = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [user.email, user.name, user.XJTLUaccount, user.XJTLUPassword, user.passwordHash, 
             user.JWTtoken, user.MStoken, user.MSbinded ? 1 : 0, user.ebridgeBinded ? 1 : 0, user.timetableUrl, user.id]
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
    
    async addTask(userId: string, task: Task): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        
        await this.db.run(
            `INSERT INTO tasks 
             (id, userId, name, description, dueDate, startTime, endTime, 
              location, completed, pushedToMSTodo, body, attendees) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [task.id, userId, task.name, task.description, task.dueDate, 
             task.startTime, task.endTime, task.location, task.completed ? 1 : 0, 
             task.pushedToMSTodo ? 1 : 0, task.body, task.attendees ? JSON.stringify(task.attendees) : null]
        );
    }
    
    async updateTask(task: Task): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        
        await this.db.run(
            `UPDATE tasks 
             SET name = ?, description = ?, dueDate = ?, startTime = ?, endTime = ?, 
                 location = ?, completed = ?, pushedToMSTodo = ?, body = ?, attendees = ?, 
                 updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [task.name, task.description, task.dueDate, task.startTime, task.endTime, 
             task.location, task.completed ? 1 : 0, task.pushedToMSTodo ? 1 : 0, 
             task.body, task.attendees ? JSON.stringify(task.attendees) : null, task.id]
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
            attendees: row.attendees ? JSON.parse(row.attendees) : undefined
        }));
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