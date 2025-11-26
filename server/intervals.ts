import axios from 'axios';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import { Options, PythonShell } from 'python-shell';
import { ExchangeClient } from './Services/exchangeClient';
import { dbService } from './Services/dbService';
import type { ExchangeConfig, ScheduleType } from './Services/types';
import { ScheduleConflictError, findConflictingTasks } from './Services/scheduleConflict';
import { broadcastTaskChange } from './Services/websocket';
import { logUserEvent } from './Services/userLog';
import { syncUserTimetable } from './Services/timetable';
import { logger } from './Utils/logger.js';
import jwt from 'jsonwebtoken';

// 注意：为避免与 index.ts 产生循环依赖，这里本地定义与 index.ts 一致的类型签名
export interface Task {
    id: string;
    name: string;
    description: string;
    dueDate: string;
    startTime: string;
    endTime: string;
    location?: string;
    completed: boolean;
    pushedToMSTodo: boolean;
    body?: string;
    attendees?: string[];
    recurrenceRule?: string;
    parentTaskId?: string;
    importance?: 'high' | 'normal' | 'low';
    isReminderOn?: boolean;
    scheduleType?: ScheduleType;
}

export interface User {
    timetableUrl: string;
    timetableFetchLevel: number;
    mailReadingSpan: number;
    id: string;
    email: string;
    name: string;
    XJTLUaccount?: string;
    XJTLUPassword?: string;
    passwordHash?: string;
    JWTtoken?: string;
    MStoken?: string;
    MSbinded: boolean;
    ebridgeBinded: boolean;
    tasks: Task[];
    emsClient?: ExchangeClient;
    conflictBoundaryInclusive?: boolean;
}

const JWT_SECRET = process.env.JWT_SECRET || '';
function verifyJwt(token: string) {
    try {
        return jwt.verify(token, JWT_SECRET) as any;
    } catch (e) {
        return null;
    }
}

export interface IntervalController {
    stop: () => void;
}

export function startIntervals(getUsers: () => IterableIterator<User>): IntervalController {
    // Interval 1: 处理 JWT 过期、Exchange 事件、邮件处理、推送 To Do、课表拉取
    const interval1 = setInterval(async () => {
        for (const user of getUsers()) {
            logger.info(`Processing user ${user.id},with ebridgeBinded:${user.ebridgeBinded},XJTLUPassword:${user.XJTLUPassword},timetableUrl:${user.timetableUrl}`);

            if (user.JWTtoken) {
                const decoded = verifyJwt(user.JWTtoken);
                if (decoded && decoded.exp) {
                    const exp = decoded.exp as number;
                    if (exp * 1000 < Date.now()) {
                        user.JWTtoken = '';
                        logger.info(`JWT token expired for user ${user.id}`);
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
                            scheduleType: 'single',
                            importance: event.importance,
                            isReminderOn: event.isReminderOn,
                        } as Task;
                        try {
                            // Check for conflicts but don't block
                            const conflicts = findConflictingTasks(user.tasks, newTask, { boundaryConflict: !!user.conflictBoundaryInclusive });

                            await dbService.addTask(user.id, newTask, !!user.conflictBoundaryInclusive, true);
                            broadcastTaskChange('created', newTask, user.id);
                            await dbService.refreshUserTasksIncremental(user, { addedIds: [newTask.id] });
                            
                            if (conflicts.length > 0) {
                                logger.warn(`Added conflicting event task ${newTask.id} for user ${user.id} with warning`);
                                await logUserEvent(user.id, 'taskConflictWarning', `Added conflicting calendar event with warning: ${newTask.name}`, { id: newTask.id, startTime: newTask.startTime, endTime: newTask.endTime, conflicts: conflicts.map(c => c.id) });
                            } else {
                                await logUserEvent(user.id, 'taskCreated', `Created task from calendar event: ${newTask.name}`, { id: newTask.id, source: 'Exchange', startTime: newTask.startTime, endTime: newTask.endTime });
                            }
                        } catch (e: any) {
                            logger.error(`Failed to persist event task ${newTask.id} for user ${user.id}:`, e);
                            await logUserEvent(user.id, 'taskError', `Failed to persist calendar event: ${newTask.name}`, { id: newTask.id, error: (e as any)?.message });
                        }
                    }
                } catch (error) {
                    logger.error(`Failed to get events for user ${user.id}:`, error);
                    await logUserEvent(user.id, 'eventsError', `Failed to fetch calendar events`, { error: (error as any)?.message });
                }

                user.emsClient = emailClient;
            }

            if (user.mailReadingSpan > 0 && user.emsClient) {
                try {
                    logger.info(`Reading email for user ${user.id}, remaining span: ${user.mailReadingSpan}`);
                    const emails = await user.emsClient.findEmails(Number(process.env.EMAIL_READ_LIMIT) || 30);
                    const email = emails[user.mailReadingSpan - 1];
                    const fullEmail = await user.emsClient.getEmailById(email.id);
                    await user.emsClient.autoProcessNewEmail(fullEmail);
                    await logUserEvent(user.id, 'emailProcessed', `Processed email: ${fullEmail.subject}`, { emailId: email.id, subject: fullEmail.subject });
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
                    // Skip MS Graph actions if user has no token or has been paused due to previous 401
                    if (!user.MStoken) continue;
                    if (!user.MStoken) continue;
                    if (!user.MSbinded) {
                        // User marked unbound - skip pushing
                        continue;
                    }
                    const msToken = user.MStoken;
                    const graphEndpoint = `https://graph.microsoft.com/v1.0/me/todo/lists`;
                    const headers = { Authorization: `Bearer ${msToken}`, 'Content-Type': 'application/json' };

                    try {
                        const listsRes = await axios.get(graphEndpoint, { headers });
                        let targetList = (listsRes.data as any).value.find((l: any) => l.wellknownName === 'myDay');
                        if (!targetList) {
                            targetList = (listsRes.data as any).value.find((l: any) => l.wellknownName === 'defaultList') || (listsRes.data as any).value[0];
                        }
                        if (!targetList) throw new Error('No list found');

                        const payload: any = {
                            title: task.name,
                            body: { content: task.description || '', contentType: 'text' },
                            dueDateTime: { dateTime: task.dueDate, timeZone: 'UTC' },
                            startDateTime: task.startTime ? { dateTime: task.startTime, timeZone: 'UTC' } : undefined,
                            importance: task.importance || 'normal',
                            status: task.completed ? 'completed' : 'notStarted'
                        };

                        if (task.isReminderOn && task.startTime) {
                            payload.reminderDateTime = { dateTime: task.startTime, timeZone: 'UTC' };
                        }

                        await axios.post(`https://graph.microsoft.com/v1.0/me/todo/lists/${targetList.id}/tasks`, payload, { headers });

                        task.pushedToMSTodo = true;
                        logger.success(`Pushed task ${task.id} to MS Todo`);
                        await dbService.updateTask(task);
                        await logUserEvent(user.id, 'msTodoPushed', `Pushed task to MS To Do: ${task.name}`, { id: task.id });
                    } catch (error: any) {
                        if (error.response?.status === 401) {
                            logger.error(`MS Graph API 401 Unauthorized for task ${task.id}: Token may be expired or invalid`);
                            // Pause further MS Graph attempts for this user until token refresh
                            try {
                                // Token invalid: clear token and mark as unbound to pause further attempts
                                user.MStoken = '';
                                user.MSbinded = false;
                                await dbService.updateUser(user);
                                await logUserEvent(user.id, 'msGraphPaused', 'Cleared MS token and paused MS Graph operations due to 401 Unauthorized');
                                logger.warn(`Cleared MStoken and set MSbinded=false for user ${user.id} until token is refreshed.`);
                            } catch (e) {
                                logger.error('Failed to persist MSbinded paused state:', e);
                            }
                        } else if (error.response?.status === 403) {
                            logger.error(`MS Graph API 403 Forbidden for task ${task.id}: Insufficient permissions`);
                        } else if (error.response?.status) {
                            logger.error(`MS Graph API ${error.response.status} error for task ${task.id}:`, error.response.data || error.message);
                        } else {
                            logger.error(`Failed to push task ${task.id} to MS Todo:`, error.message || error);
                            await logUserEvent(user.id, 'msTodoPushError', `Failed to push task to MS To Do: ${task.name}`, { id: task.id, error: error?.message, status: error?.response?.status });
                        }
                        continue;
                    }
                }
            }

            if (user.ebridgeBinded && user.timetableUrl) {
                try {
                    await syncUserTimetable(user);
                } catch (e) {
                    // Error logging is handled inside syncUserTimetable, but catch here to be safe
                }
            }
        }
        logger.info('Checked all users for Ebridge status');
    }, 20000);

    // Interval 2: 后台检查 ebridge 连接并获取 timetableUrl
    const interval2 = setInterval(() => {
        for (const user of getUsers()) {
            if ((!user.timetableUrl) && user.XJTLUPassword) {
                (async () => {
                    try {
                        const pythonScriptPath = './server/Services/ebEmulator/ebridge.py';
                        logger.info(`Executing Python script to check Ebridge connection for user ${user.id}`);
                        const options = {
                            mode: 'text',
                            pythonOptions: ['-u'],
                            args: [user.XJTLUaccount, user.XJTLUPassword]
                        } as Options;

                        const timetableUrl = await PythonShell.run(pythonScriptPath, options).then((results: string[]) => {
                            logger.info(`Python script output for user ${user.id}: ${results}`);
                            if (results && results.length > 0) {
                                const output = results[0];
                                if (output && output.startsWith('http')) return output;
                                throw new Error(`Invalid timetable URL returned: ${output}`);
                            } else {
                                throw new Error('No output returned from Python script');
                            }
                        });

                        user.timetableUrl = timetableUrl as string;
                        user.ebridgeBinded = true;
                        await dbService.updateUser(user);
                        logger.success(`Successfully connected to Ebridge for user ${user.id}, timetable URL: ${timetableUrl}`);
                    } catch (error) {
                        logger.error('Ebridge connection check failed for user ' + (user?.id || 'unknown') + ':', error);
                    }
                })();
            }
        }
    }, 50000);

    return {
        stop() {
            clearInterval(interval1);
            clearInterval(interval2);
        }
    };
}
