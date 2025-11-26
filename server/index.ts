import * as msal from '@azure/msal-node';
import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import {ExchangeClient} from './Services/exchangeClient';
import {dbService} from './Services/dbService';
import moment from 'moment';
import { initializeApiRoutes } from './routes/apiRoutes';
import { Options, PythonShell } from 'python-shell';
import { ExchangeConfig, TimetableActivity, ScheduleType } from './Services/types';
import { ScheduleConflictError } from './Services/scheduleConflict';
import { initWebSocket, broadcastTaskChange, broadcastUserLog } from './Services/websocket';
import { logUserEvent } from './Services/userLog';
import { logger } from './Utils/logger.js';
import { EmailMessageSchema, SearchFilter } from 'ews-javascript-api';
import { startIntervals } from './intervals';
import { initializeMcpRoutes } from './Services/mcp';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 全局错误处理 - 防止服务器崩溃
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // 不退出进程，只记录错误
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // 对于致命错误，优雅关闭
    if (error.message?.includes('EADDRINUSE')) {
        logger.error('Port already in use, exiting...');
        process.exit(1);
    }
    // 其他错误不退出，只记录
});

const app = express();
app.use(cors());

// Exclude MCP messages endpoint from body parsing because SSEServerTransport handles the stream directly
app.use((req, res, next) => {
    if (req.path === '/api/mcp/messages') {
        next();
    } else {
        express.json()(req, res, next);
    }
});

const PORT = process.env.PORT || 3000;

// 将在authenticateToken函数定义后配置API路由
export interface Task {
    id: string;
    name: string;
    description: string;
    dueDate: string; // ISO 8601 格式
    startTime: string; // ISO 8601 格式
    endTime: string; // ISO 8601 格式
    location?: string;
    completed: boolean;
    pushedToMSTodo: boolean; // 是否已推送至 Microsoft Todo
    body?: string; // fit IEvent.body
    attendees?: string[]; // fit IEvent.attendees
    recurrenceRule?: string; // JSON字符串，包含 {freq:'daily'|'weekly', interval?:number, count?:number, until?:ISO}
    parentTaskId?: string; // 若为重复任务生成的子实例，则指向源任务
    importance?: 'high' | 'normal' | 'low';
    isReminderOn?: boolean;
    scheduleType?: ScheduleType;
}

export interface User {
    timetableUrl: string;
    timetableFetchLevel: number; // 时间表获取级别，用于控制重新获取频率
    mailReadingSpan: number; // 邮件阅读跨度，控制从收件箱读取的邮件数量，默认为30
    id: string;
    email: string;
    name: string;
    XJTLUaccount?: string; 
    XJTLUPassword?: string; 
    passwordHash?: string; // only for local accounts
    JWTtoken?: string; // latest issued JWT for user (optional)
    MStoken?: string; // Microsoft access token (optional)
        MSbinded: boolean; // 是否绑定了 Microsoft 账号
        ebridgeBinded: boolean; // 是否绑定了 ebridge 账号
    weekOffset?: number; // 用户自定义周数偏移量，叠加在全局偏移之上
    tasks: Task[]; // 用户绑定的任务列表
    emsClient?: ExchangeClient; // 用于操作 Exchange 的客户端
    conflictBoundaryInclusive?: boolean; // 端点相接是否算冲突（true=算）
}


// 用户池 - 现在使用数据库持久化，内存中保留缓存
let userCache: Map<string, User> = new Map();

const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = '1h';

function signJwt(payload: object) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyJwt(token: string) {
    try {
        return jwt.verify(token, JWT_SECRET) as any;
    } catch (e) {
        return null;
    }
}

async function findUserByEmail(email: string) {
    // 先从缓存中查找
    for (const u of userCache.values()) {
        if (u.email.toLowerCase() === email.toLowerCase()) return u;
    }
    
    // 从数据库中查找
    const user = await dbService.getUserByEmail(email);
    if (user) {
        // 更新缓存
        userCache.set(user.id, user);
    }
    return user;
}

async function pairMsTokenToUser(userId: string, msToken: string) {
    let u = userCache.get(userId);
    
    if (!u) {
        // 从数据库加载
        u = await dbService.getUserById(userId) || undefined;
        if (!u) return false;
    }
    
    u.MStoken = msToken;
    u.MSbinded = true; // 标记为已绑定并激活
    // 新的 token 到来，标记为已绑定
    
    // 更新数据库和缓存
    await dbService.updateUser(u);
    userCache.set(userId, u);
    return true;
}

// 从环境变量读取学术配置
let academicConfig: any = {
    academicYearSettings: {
        weekOffset: parseInt(process.env.ACADEMIC_WEEK_OFFSET || '0'),
        academicYearStartMonth: parseInt(process.env.ACADEMIC_YEAR_START_MONTH || '9'),
        academicYearStartDay: parseInt(process.env.ACADEMIC_YEAR_START_DAY || '1')
    }
};

logger.info('Academic configuration loaded from environment variables');

// 读取Microsoft配置
const config = {
    auth: {
        clientId: process.env.MS_CLIENT_ID || "",
        authority: process.env.MS_AUTHORITY || "https://login.microsoftonline.com/common",
        clientSecret: process.env.MS_CLIENT_SECRET
    }
};

// 验证必需的配置项
if (!config.auth.clientSecret) {
    logger.error('错误: MS_CLIENT_SECRET 环境变量未设置!');
    process.exit(1);
}

if (!config.auth.clientId) {
    logger.error('错误: MS_CLIENT_ID 环境变量未设置!');
    process.exit(1);
}

logger.info('Microsoft configuration loaded from environment variables');

// 获取当前学年的周次
function getCurrentWeekNumber(): number {
    const { weekOffset, academicYearStartMonth, academicYearStartDay } = academicConfig.academicYearSettings;
    
    // 学年从指定月份和日期开始
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    
    // 确定当前学年的起始日期
    let academicYearStart: Date;
    if (currentDate.getMonth() >= academicYearStartMonth - 1) { // 当前月份大于等于学年开始月份
        academicYearStart = new Date(year, academicYearStartMonth - 1, academicYearStartDay);
    } else {
        academicYearStart = new Date(year - 1, academicYearStartMonth - 1, academicYearStartDay);
    }
    
    // 计算当前日期与学年开始日期的天数差
    const timeDiff = currentDate.getTime() - academicYearStart.getTime();
    const dayDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
    
    // 计算周次（向上取整）并应用偏移量
    const rawWeekNumber = Math.ceil((dayDiff + 1) / 7);
    const adjustedWeekNumber = rawWeekNumber + weekOffset;
    
    return Math.max(1, adjustedWeekNumber); // 确保周数至少为1
}

// 身份验证中间件
async function authenticateToken(req: any, res: any, next: any) {
    let token = req.headers.authorization && req.headers.authorization.split(' ')[1];
    
    // 如果Header中没有token，尝试从query参数获取 (用于SSE等不支持Header的场景)
    if (!token && req.query.token) {
        token = req.query.token;
    }

    if (!token) return res.status(401).json({ error: 'Access token required' });
    
    const decoded = verifyJwt(token);
    if (!decoded) return res.status(403).json({ error: 'Invalid or expired token' });
    
    // 先从缓存获取
    let user = userCache.get(decoded.sub);
    
    // 缓存未命中，从数据库加载
    if (!user) {
        user = await dbService.getUserById(decoded.sub) || undefined;
        if (user) {
            userCache.set(user.id, user);
        }
    }
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    req.user = user;
    next();
}

// 配置API路由
const apiRouter = initializeApiRoutes(authenticateToken);
app.use('/api', apiRouter);

// Initialize MCP Routes
initializeMcpRoutes(app, authenticateToken);

const pca = new msal.ConfidentialClientApplication(config);

// 注册端点：创建本地用户并发放 JWT
app.post('/register', async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) return res.status(400).json({ error: 'email, password and name required' });

    try {
        // 检查用户是否已存在
        const existingUser = await findUserByEmail(email);
        if (existingUser) return res.status(409).json({ error: 'user already exists' });

        const passwordHash = await bcrypt.hash(password, 10);
        const id = uuidv4();
        const user: User = { 
            id, 
            email, 
            name, 
            passwordHash, 
            XJTLUPassword: password, 
            MSbinded: false, 
            ebridgeBinded: false, 
            timetableUrl: '',
            timetableFetchLevel: 0,
            mailReadingSpan: 30,
            conflictBoundaryInclusive: false,
            tasks: [{
                id: uuidv4(),
                name: '测试任务',
                description: '用户注册后自动创建的测试任务',
                dueDate: new Date().toISOString(),
                startTime: new Date().toISOString(),
                endTime: new Date().toISOString(),
                completed: false,
                pushedToMSTodo: false,
                scheduleType: 'single',
            }]
        };

        const token = signJwt({ sub: id, email });
        user.JWTtoken = token;
        
        // 保存到数据库
        await dbService.addUser(user);
        // 更新缓存
        userCache.set(id, user);

        return res.status(201).json({ token });
    } catch (error) {
        logger.error('Registration error:', error);
        return res.status(500).json({ error: 'Failed to register user' });
    }
});

app.post('/updateEbridgePassword', async (req, res) => {
    const { email, ebPassword, password, XJTLUaccount } = req.body || {};
    if (!email || !ebPassword || !password || !XJTLUaccount) return res.status(400).json({ error: 'email, ebridgePassword, Password and XJTLUaccount required' });

    try {
        const user = await findUserByEmail(email);
        if (!user || !user.passwordHash) return res.status(401).json({ error: 'invalid credentials' });

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return res.status(401).json({ error: 'invalid credentials' });
        
        user.XJTLUaccount = XJTLUaccount;
        user.XJTLUPassword = ebPassword;
        user.ebridgeBinded = true;
        
        // 更新数据库和缓存
        await dbService.updateUser(user);
        userCache.set(user.id, user);

        return res.status(200).json({ message: 'ebPassword updated' });
    } catch (error) {
        logger.error('Update ebridge password error:', error);
        return res.status(500).json({ error: 'Failed to update ebridge password' });
    }
});


// 登录端点：验证凭据并返回 JWT
app.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    try {
        const user = await findUserByEmail(email);
        if (!user || !user.passwordHash) return res.status(401).json({ error: 'invalid credentials' });

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return res.status(401).json({ error: 'invalid credentials' });

        const token = signJwt({ sub: user.id, email: user.email });
        user.JWTtoken = token;
        
        // 更新数据库和缓存
        await dbService.updateUser(user);
        userCache.set(user.id, user);

        return res.json({ token });
    } catch (error) {
        logger.error('Login error:', error);
        return res.status(500).json({ error: 'Failed to login' });
    }
});

// 生成授权URL
app.get('/auth', (req, res) => {
    // 如果请求中包含我们的 JWT（query.jwt 或 Authorization header），将其作为 state 传给微软并在回调时还原
    const providedJwt = (req.query.jwt as string) || (() => {
        const auth = (req.headers.authorization || '') as string;
        if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
        return undefined;
    })();

    const state = providedJwt ? Buffer.from(providedJwt).toString('base64') : undefined;

    const authCodeUrlParameters: any = {
        scopes: ["https://graph.microsoft.com/Tasks.ReadWrite"],
        redirectUri: "http://localhost:3000/redirect",
    };
    if (state) authCodeUrlParameters.state = state;

    pca.getAuthCodeUrl(authCodeUrlParameters).then((response) => {
        res.redirect(response);
    }).catch((error) => {
        logger.error('Error generating auth URL:', error);
        res.status(500).send('Error generating auth URL');
    });
});

// 处理重定向并获取令牌
app.get('/redirect', async (req, res) => {
    const tokenRequest = {
        code: req.query.code as string,
        scopes: ["https://graph.microsoft.com/Tasks.ReadWrite"],
        redirectUri: "http://localhost:3000/redirect",
    };

    try {
        const response = await pca.acquireTokenByCode(tokenRequest);
        logger.info("Access token acquired:", response.accessToken);
        
        // 先尝试从 state 中还原我们的 JWT（如果有的话），然后把 MS 令牌配对到全局用户池
        let providedJwt: string | undefined;
        if (req.query.state) {
            try {
                providedJwt = Buffer.from(req.query.state as string, 'base64').toString('utf8');
            } catch (e) {
                logger.warn('Invalid state encoding');
            }
        }
        // 也支持通过 query.jwt 或 Authorization header 直接传递
        if (!providedJwt && req.query.jwt) providedJwt = req.query.jwt as string;
        if (!providedJwt) {
            const auth = (req.headers.authorization || '') as string;
            if (auth.toLowerCase().startsWith('bearer ')) providedJwt = auth.slice(7).trim();
        }

        if (providedJwt) {
            const decoded = verifyJwt(providedJwt);
            if (decoded && decoded.sub) {
                const userId = decoded.sub as string;
                const paired = await pairMsTokenToUser(userId, response.accessToken || '');
                if (paired) {
                    logger.info(`Paired MS token to user ${userId}`);
                    res.send('Authentication successful and MS token paired to your account.');
                    return;
                } else {
                    logger.warn('User not found for JWT sub:', decoded.sub);
                }
            } else {
                logger.warn('Invalid JWT provided in redirect state');
            }
        }

        // 如果没有提供 JWT 或配对失败，仅返回成功提示（或提供指示下一步的页面）
        res.send('身份认证成功！您已经成功绑定微软To Do。将重新跳转回主页');
        //将用户重定向到主页面
        res.redirect(process.env.FRONTEND_URL || "http://localhost:5173/");
    } catch (error) {
        logger.error('Token acquisition error:', error);
        res.status(500).send('Authentication failed');
    }
});

// API路由已移至专用模块

// Serve static files
app.use(express.static(path.join(__dirname, '../../dist')));

app.get('*', (req, res) => {
    // Don't intercept API requests
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Not Found' });
    }
    const indexPath = path.join(__dirname, '../../dist/index.html');
    // Check if file exists to avoid crashing if dist is missing
    res.sendFile(indexPath, (err) => {
        if (err) {
            if (!res.headersSent) {
                res.status(404).send('Frontend not built or not found.');
            }
        }
    });
});

// 初始化数据库并启动服务器
async function startServer() {
    try {
        // 初始化数据库
        await dbService.initialize();
        
        // 设置日志监听器
        dbService.setLogListener(broadcastUserLog);

        // 从数据库加载所有用户到缓存
        const users = await dbService.getAllUsers();
        users.forEach(user => {
            userCache.set(user.id, user);
        });
        
        logger.info(`Loaded ${users.length} users from database`);
        
        // 启动服务器并初始化 WebSocket
        const server = app.listen(PORT, () => {
            logger.info(`Server running on http://localhost:${PORT}`);
            logger.info(`Visit http://localhost:${PORT}/auth to start authentication`);
        });
        initWebSocket(server, () => userCache.values());
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

// 启动后台定时任务（抽离至 intervals.ts）
startIntervals(() => userCache.values());

export async function createTaskToUser(user: User, taskData: Task): Promise<void> {
    // 实现创建任务的逻辑
    try {
        await dbService.addTask(user.id, taskData);
        await dbService.refreshUserTasksIncremental(user, { addedIds: [taskData.id] });
        await logUserEvent(user.id, 'taskCreated', `Created task ${taskData.name} via helper`, { id: taskData.id });
        logger.success(`Task created successfully for user ${user.id}: ${taskData.name}`);
    } catch (error) {
        logger.error(`Failed to create task for user ${user.id}:`, error);
        throw error;
    }
}
