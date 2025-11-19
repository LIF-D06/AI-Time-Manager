

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
import { ExchangeConfig, TimetableActivity } from './Services/types';
import { ScheduleConflictError } from './Services/scheduleConflict';
import { initWebSocket, broadcastTaskChange } from './Services/websocket';
import { logUserEvent } from './Services/userLog';
import { logger } from './Utils/logger.js';
import { EmailMessageSchema, SearchFilter } from 'ews-javascript-api';

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
app.use(express.json());
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
    u.MSbinded = true; // 标记为已绑定
    
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
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
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

// 初始化数据库并启动服务器
async function startServer() {
    try {
        // 初始化数据库
        await dbService.initialize();
        
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

setInterval(async () => {
    // 使用缓存中的用户
    for (const user of userCache.values()) {
        logger.info(`Processing user ${user.id},with ebridgeBinded:${user.ebridgeBinded},XJTLUPassword:${user.XJTLUPassword},timetableUrl:${user.timetableUrl}`);
        if (user.JWTtoken) {
            const decoded = verifyJwt(user.JWTtoken);
            if (decoded && decoded.exp) {
                const exp = decoded.exp as number;
                if (exp * 1000 < Date.now()) {
                    user.JWTtoken = '';
                    logger.info(`JWT token expired for user ${user.id}`);
                    // 更新数据库
                    await dbService.updateUser(user);
                }
            }
        }

        if (user.JWTtoken && user.XJTLUPassword && !user.emsClient) {
            const exchangeConfig = {
                exchangeUrl: process.env.EXCHANGE_URL || "https://mail.xjtlu.edu.cn/EWS/Exchange.asmx",
                username: user.email.split('@')[0],
                password: user.XJTLUPassword,
                domain: process.env.EXCHANGE_DOMAIN || "xjtlu.edu.cn",
                openaiApiKey: process.env.OPENAI_API_KEY || "",
                openaiModel: process.env.OPENAI_MODEL || 'deepseek-chat',  
                MStoken: user.MStoken,
            } as ExchangeConfig;

            logger.info(`Lunching ExchangeClient for user ${user.id}, with ${JSON.stringify(exchangeConfig)}`);
            
            const emailClient = new ExchangeClient(exchangeConfig, user);
            
            try {
                const events = await emailClient.getEvents(
                    moment().subtract(1, 'day').toISOString(),
                    moment().add(1, 'day').toISOString(),
                );
                
                logger.info(`Fetched ${events.length} events for user ${user.id}`);
                await logUserEvent(user.id, 'eventsFetched', `Fetched ${events.length} calendar events`, { count: events.length });
                
                // 检查并添加新事件
                for (const event of events) {
                    const existingTask = user.tasks.find(task => task.id === event.id);
                    if (existingTask) continue;
                    const newTask = {
                        id: event.id || uuidv4(),
                        name: event.subject,
                        startTime: event.start,
                        endTime: event.end,
                        location: event.location || '',
                        body: event.body || '',
                        attendees: event.attendees || [],
                        description: event.body || '',
                        dueDate: event.end,
                        completed: false,
                        pushedToMSTodo: false,
                    };
                    try {
                        await dbService.addTask(user.id, newTask, !!user.conflictBoundaryInclusive);
                        broadcastTaskChange('created', newTask, user.id);
                        // 增量刷新缓存：合并新创建的事件任务
                        await dbService.refreshUserTasksIncremental(user, { addedIds: [newTask.id] });
                        await logUserEvent(user.id, 'taskCreated', `Created task from calendar event: ${newTask.name}`, { id: newTask.id, source: 'Exchange', startTime: newTask.startTime, endTime: newTask.endTime });
                    } catch (e:any) {
                        if (e instanceof ScheduleConflictError) {
                            logger.warn(`Skipped conflicting event task ${newTask.id} for user ${user.id}`);
                            await logUserEvent(user.id, 'taskConflict', `Skipped conflicting calendar event: ${newTask.name}`, { id: newTask.id, startTime: newTask.startTime, endTime: newTask.endTime });
                        } else {
                            logger.error(`Failed to persist event task ${newTask.id} for user ${user.id}:`, e);
                            await logUserEvent(user.id, 'taskError', `Failed to persist calendar event: ${newTask.name}`, { id: newTask.id, error: (e as any)?.message });
                        }
                    }
                }
            } catch (error) {
                console.error(`Failed to get events for user ${user.id}:`, error);
                await logUserEvent(user.id, 'eventsError', `Failed to fetch calendar events`, { error: (error as any)?.message });
            }
            
            // 仅在内存中保存客户端实例
            user.emsClient = emailClient;
        }

        if (user.mailReadingSpan > 0 && user.emsClient) {
            try {
                logger.info(`Reading email for user ${user.id}, remaining span: ${user.mailReadingSpan}`);
                // 获取收件箱中的邮件（限制为EMAIL_READ_LIMIT封，按接收时间倒序）
                const emails = await user.emsClient.findEmails(Number(process.env.EMAIL_READ_LIMIT) || 30); 
                // 提取最新一封邮件
                const email = emails[user.mailReadingSpan - 1];
                // 获取邮件完整内容（包括正文）
                const fullEmail = await user.emsClient.getEmailById(email.id);
                // 解析邮件内容
                await user.emsClient.autoProcessNewEmail(fullEmail);
                await logUserEvent(user.id, 'emailProcessed', `Processed email ${email.id}`, { emailId: email.id });
                user.mailReadingSpan--;
                await dbService.updateUser(user);
                logger.info(`Decremented mailReadingSpan for user ${user.id}, new value: ${user.mailReadingSpan}`);
            } catch (emailError) {
                logger.error(`Failed to read email for user ${user.id}:`, emailError);
                await logUserEvent(user.id, 'emailError', `Failed to process email`, { error: (emailError as any)?.message });
            }
        }
        
        for (const task of user.tasks) {
            

            if (!task.pushedToMSTodo) {
                if (!user.MStoken) continue;
                const msToken = user.MStoken;
                const graphEndpoint = `https://graph.microsoft.com/v1.0/me/todo/lists`;
                const headers = { Authorization: `Bearer ${msToken}`, 'Content-Type': 'application/json' };
                
                try {
                    // 直接获取默认列表，不再创建新的列表
                    const listsRes = await axios.get(graphEndpoint, { headers });
                    
                    // 尝试获取"我的一天"列表
                    let targetList = listsRes.data.value.find((l: any) => l.wellknownName === 'myDay');
                    
                    // 如果没有找到"我的一天"列表，使用默认列表
                    if (!targetList) {
                        targetList = listsRes.data.value.find((l: any) => l.wellknownName === 'defaultList') || listsRes.data.value[0];
                    }
                    
                    if (!targetList) throw new Error('No list found');
                    
                    // 直接将任务添加到目标列表
                    await axios.post(`https://graph.microsoft.com/v1.0/me/todo/lists/${targetList.id}/tasks`, {
                        title: task.name,
                        body: { content: task.description || '', contentType: 'text' },
                        dueDateTime: { dateTime: task.dueDate, timeZone: 'UTC' },
                        startDateTime: task.startTime ? { dateTime: task.startTime, timeZone: 'UTC' } : undefined,
                        reminderDateTime: task.startTime ? { dateTime: task.startTime, timeZone: 'UTC' } : undefined,
                        importance: 'normal',
                        status: task.completed ? 'completed' : 'notStarted'
                    }, { headers });
                    
                    task.pushedToMSTodo = true;
                    logger.success(`Pushed task ${task.id} to MS Todo`);
                    
                    // 更新数据库中的任务
                    await dbService.updateTask(task);
                    await logUserEvent(user.id, 'msTodoPushed', `Pushed task to MS To Do: ${task.name}`, { id: task.id });
                } catch (error: any) {
                    if (error.response?.status === 401) {
                        logger.error(`MS Graph API 401 Unauthorized for task ${task.id}: Token may be expired or invalid`);
                        // 可以选择清除用户的MS token，让用户重新授权
                        // user.MStoken = null;
                        // await dbService.updateUser(user);
                    } else if (error.response?.status === 403) {
                        logger.error(`MS Graph API 403 Forbidden for task ${task.id}: Insufficient permissions`);
                    } else if (error.response?.status) {
                        logger.error(`MS Graph API ${error.response.status} error for task ${task.id}:`, error.response.data || error.message);
                    } else {
                        logger.error(`Failed to push task ${task.id} to MS Todo:`, error.message || error);
                        await logUserEvent(user.id, 'msTodoPushError', `Failed to push task to MS To Do: ${task.name}`, { id: task.id, error: error?.message, status: error?.response?.status });
                    }
                    // 继续处理其他任务，不中断整个流程
                    continue;
                }
            }
        }
        if ((!user.timetableUrl)  && user.XJTLUPassword) {
        if (user.XJTLUPassword) {
        // 创建异步函数在后台执行
        (async () => {
          try {
            // 使用python-shell执行Python脚本
            const pythonScriptPath = './server/Services/ebEmulator/ebridge.py';
            
            logger.info(`Executing Python script to check Ebridge connection for user ${user.id}`);
            
            // 执行Python脚本并获取输出
            const options = {
              mode: "text",
              pythonOptions: ['-u'], // 无缓冲输出
              args: [user.XJTLUaccount, user.XJTLUPassword]
            } as Options;
            
            const timetableUrl = await PythonShell.run(pythonScriptPath, options).then((results: string[]) => {
                logger.info(`Python script output for user ${user.id}: ${results}`);
                if (results && results.length > 0) {
                  const output = results[0];
                  if (output && output.startsWith('http')) {
                    return output;
                  } else {
                    throw new Error(`Invalid timetable URL returned: ${output}`);
                  }
                } else {
                  throw new Error('No output returned from Python script');
                }
              });
            
            // timetableUrl已验证有效
            user.timetableUrl = timetableUrl;
            user.ebridgeBinded = true;
            // 更新数据库中的用户
            await dbService.updateUser(user);

            // 记录成功连接的信息到控制台
            logger.success(`Successfully connected to Ebridge for user ${user.id}, timetable URL: ${timetableUrl}`);
            
          } catch (error) {
            logger.error('Ebridge connection check failed:', error);
          }
        })();
            }
        }
        if (user.ebridgeBinded && user.timetableUrl) {
            // 检查是否需要重新获取时间表（仅当环境变量中的timetableFetchLevel大于用户存储的值时才重新获取）
            const envFetchLevel = parseInt(process.env.timetableFetchLevel || '0');
            const userFetchLevel = user.timetableFetchLevel || 0;
            
            if (envFetchLevel <= userFetchLevel) {
                logger.info(`Skipping timetable fetch for user ${user.id}: env level (${envFetchLevel}) <= user level (${userFetchLevel})`);
                return;
            }
            
            try {
                // 从timetableUrl中提取hash值
                let hashMatch = user.timetableUrl.split('/');
                hashMatch = hashMatch[5].split('?');
                if (hashMatch && hashMatch[0]) {
                    const hash = hashMatch[0];
                    logger.info(`Extracted hash: ${JSON.stringify(hashMatch)}`);
                    // 构建API请求URL
                    const apiUrl = `https://timetableplus.xjtlu.edu.cn/ptapi/api/enrollment/hash/${hash}/activity?start=1&end=13`;
                    logger.info(`Requesting URL: ${apiUrl}`);
                    const response = await axios.get<TimetableActivity[]>(apiUrl);
                    
                    if (response.status === 200 && Array.isArray(response.data)) {
                        logger.success(`Successfully fetched timetable data for user ${user.id}, found ${response.data.length} activities`);
                        await logUserEvent(user.id, 'timetableFetched', `Fetched timetable activities: ${response.data.length}`, { count: response.data.length });
                        
                        // 更新用户的timetableFetchLevel为当前环境变量的值
                        const envFetchLevel = parseInt(process.env.timetableFetchLevel || '0');
                        user.timetableFetchLevel = envFetchLevel;
                        await dbService.updateUser(user);
                        logger.info(`Updated timetableFetchLevel for user ${user.id} to ${envFetchLevel}`);
                        
                        // 解析周次模式的辅助函数
                        function parseWeekPattern(pattern: string): number[] {
                            const weeks: number[] = [];
                            if (!pattern) return weeks;
                            
                            // 处理类似 "1-3, 4-13" 这样的格式
                            const ranges = pattern.split(',');
                            for (const range of ranges) {
                                const trimmedRange = range.trim();
                                if (trimmedRange.includes('-')) {
                                    const [start, end] = trimmedRange.split('-').map(Number);
                                    for (let i = start; i <= end; i++) {
                                        weeks.push(i);
                                    }
                                } else {
                                    weeks.push(Number(trimmedRange));
                                }
                            }
                            return weeks;
                        }
                        
                        // 获取星期名称的辅助函数
                        function getDayName(dayIndex: number): string {
                            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                            return days[dayIndex] || 'Unknown';
                        }
                        
                        // getCurrentWeekNumber function moved to global scope
                        
                        // 获取当前日期（今天的0点0分0秒）
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        
                        // 计算下周结束的日期（今天 + 7天）
                        const nextWeekEnd = new Date(today);
                        nextWeekEnd.setDate(today.getDate() + 7);
                        
                        // 将响应转换为Task格式并添加给用户
                        for (const activity of response.data) {
                            try {
                                // 解析活动的周次和星期
                                const weeks = parseWeekPattern(activity.weekPattern || '');
                                // API返回的scheduledDay是0-6，其中0=周一，需要转换为JavaScript的0-6（0=周日，6=周六）
                                const apiDay = activity.scheduledDay ? parseInt(activity.scheduledDay) : 0;
                                // 转换：apiDay 0=周一, 1=周二, 2=周三, 3=周四, 4=周五, 5=周六, 6=周日
                                // JavaScript: 0=周日, 1=周一, 2=周二, 3=周三, 4=周四, 5=周五, 6=周六
                                const scheduledDay = apiDay === 6 ? 0 : apiDay + 1;
                                
                                // 解析时间部分（不使用日期部分）
                                const startTimeObj = activity.startTime ? new Date(activity.startTime) : new Date();
                                const endTimeObj = activity.endTime ? new Date(activity.endTime) : new Date(Date.now() + 3600000);
                                
                                // 计算本周的目标日
                                const currentDayOfWeek = today.getDay() ; // 0-6，0是周日
                                
                                // 计算本周的课程日期
                                let thisWeekCourseDate = new Date(today);
                                
                                // 计算到本周该课程日的天数差
                                const daysDifference = scheduledDay - currentDayOfWeek;
                                
                                // 如果课程日在本周且在今天之后
                                if (daysDifference > 0) {
                                    thisWeekCourseDate.setDate(today.getDate() + daysDifference);
                                } 
                                // 如果今天就是课程日
                                else if (daysDifference === 0) {
                                    // 保留今天
                                } 
                                // 如果课程日在本周且在今天之前
                                else {
                                    // 为了本周的课程日期，需要减去相应的天数（但不改变为下周）
                                    thisWeekCourseDate.setDate(today.getDate() + daysDifference);
                                }
                                
                                // 生成未来一周内的所有可能课程日期
                                const potentialCourseDates: Date[] = [];
                                
                                // 添加本周的课程日期（如果在范围内）
                                if (thisWeekCourseDate >= today && thisWeekCourseDate <= nextWeekEnd) {
                                    potentialCourseDates.push(thisWeekCourseDate);
                                }
                                
                                // 添加下周的课程日期（如果在范围内）
                                const nextWeekCourseDate = new Date(thisWeekCourseDate);
                                nextWeekCourseDate.setDate(thisWeekCourseDate.getDate() + 7);
                                if (nextWeekCourseDate <= nextWeekEnd) {
                                    potentialCourseDates.push(nextWeekCourseDate);
                                }
                                
                                // 为每个潜在的课程日期创建任务
                                for (const courseDate of potentialCourseDates) {
                                    // 创建完整的课程时间
                                    const courseStartTime = new Date(courseDate);
                                    courseStartTime.setHours(startTimeObj.getHours(), startTimeObj.getMinutes(), startTimeObj.getSeconds());
                                    
                                    const courseEndTime = new Date(courseDate);
                                    courseEndTime.setHours(endTimeObj.getHours(), endTimeObj.getMinutes(), endTimeObj.getSeconds());
                                    
                                    // 确保开始时间在未来
                                    if (courseStartTime >= today) {
                                        // 创建唯一的任务ID
                                        const taskId = `timetable_${hash}_${activity.identity || uuidv4()}_${courseDate.toISOString().split('T')[0]}`;
                                        
                                        // 检查任务是否已存在
                                        const existingTask = user.tasks.find(task => task.id === taskId);
                                        if (!existingTask) {
                                            // 获取当前周的周次信息
                                            const currentWeekNumber = getCurrentWeekNumber();
                                            
                                            // 将时间表活动转换为任务格式
                                            const newTask: Task = {
                                                id: taskId,
                                                name: activity.name || `${activity.moduleId || 'Unknown'} - ${activity.activityType || 'Activity'}`,
                                                description: `Staff: ${activity.staff || 'Unknown'}\nLocation: ${activity.location || 'Online'}\nWeek Pattern: ${activity.weekPattern || 'N/A'}\nCurrent Week: ${currentWeekNumber}\nDay: ${getDayName(scheduledDay)}`,
                                                dueDate: courseDate.toISOString(),
                                                startTime: courseStartTime.toISOString(),
                                                endTime: courseEndTime.toISOString(),
                                                location: activity.location || undefined,
                                                completed: false,
                                                pushedToMSTodo: false,
                                                body: JSON.stringify(activity),
                                            };
                                            
                                            // 添加到用户任务列表
                                            try {
                                                await dbService.addTask(user.id, newTask, !!user.conflictBoundaryInclusive);
                                                broadcastTaskChange('created', newTask, user.id);
                                                await dbService.refreshUserTasksIncremental(user, { addedIds: [newTask.id] });
                                                logger.info(`Added timetable task: ${newTask.name} on ${courseDate.toLocaleDateString()} (Week: ${currentWeekNumber}) for user ${user.id}`);
                                                await logUserEvent(user.id, 'taskCreated', `Created timetable task ${newTask.name}`, { id: newTask.id, startTime: newTask.startTime, endTime: newTask.endTime });
                                            } catch (e:any) {
                                                if (e instanceof ScheduleConflictError) {
                                                    logger.warn(`Skipped conflicting timetable task ${newTask.id} for user ${user.id}`);
                                                    await logUserEvent(user.id, 'taskConflict', `Skipped conflicting timetable task ${newTask.name}`, { id: newTask.id });
                                                } else {
                                                    logger.error(`Failed to add timetable task ${newTask.id} for user ${user.id}:`, e);
                                                    await logUserEvent(user.id, 'taskError', `Failed to add timetable task ${newTask.name}`, { id: newTask.id, error: (e as any)?.message });
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (parseError) {
                                logger.error(`Error processing activity ${activity.identity || 'unknown'}:`, parseError);
                                await logUserEvent(user.id, 'timetableParseError', `Failed to process timetable activity`, { activityId: activity.identity || 'unknown', error: (parseError as any)?.message });
                            }
                        }
                    }else{
                        logger.warn(`Failed to fetch timetable for user ${user.id}`);
                        await logUserEvent(user.id, 'timetableError', `Failed to fetch timetable`, {});
                    }
                } else {
                    logger.warn(`Failed to extract hash from timetableUrl for user ${user.id} `);
                    await logUserEvent(user.id, 'timetableError', `Failed to extract timetable hash`, {});
                }
            } catch (error) {
                logger.error(`Failed to process timetable for user ${user.id}:`, error);
                await logUserEvent(user.id, 'timetableError', `Failed to process timetable`, { error: (error as any)?.message });
            }
        }
    }
    logger.info('Checked all users for Ebridge status');
}, 20000);

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
