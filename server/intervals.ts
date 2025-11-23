import axios from 'axios';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import { Options, PythonShell } from 'python-shell';
import { ExchangeClient } from './Services/exchangeClient';
import { dbService } from './Services/dbService';
import { ExchangeConfig, TimetableActivity } from './Services/types';
import { ScheduleConflictError } from './Services/scheduleConflict';
import { broadcastTaskChange } from './Services/websocket';
import { logUserEvent } from './Services/userLog';
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

function getCurrentWeekNumber(): number {
    const weekOffset = parseInt(process.env.ACADEMIC_WEEK_OFFSET || '0');
    const academicYearStartMonth = parseInt(process.env.ACADEMIC_YEAR_START_MONTH || '9');
    const academicYearStartDay = parseInt(process.env.ACADEMIC_YEAR_START_DAY || '1');

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
    const adjustedWeekNumber = rawWeekNumber + weekOffset;
    return Math.max(1, adjustedWeekNumber);
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
                            importance: event.importance,
                            isReminderOn: event.isReminderOn,
                        } as Task;
                        try {
                            await dbService.addTask(user.id, newTask, !!user.conflictBoundaryInclusive);
                            broadcastTaskChange('created', newTask, user.id);
                            await dbService.refreshUserTasksIncremental(user, { addedIds: [newTask.id] });
                            await logUserEvent(user.id, 'taskCreated', `Created task from calendar event: ${newTask.name}`, { id: newTask.id, source: 'Exchange', startTime: newTask.startTime, endTime: newTask.endTime });
                        } catch (e: any) {
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
                    if (!user.MStoken) continue;
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
                const envFetchLevel = parseInt(process.env.timetableFetchLevel || '0');
                const userFetchLevel = user.timetableFetchLevel || 0;
                if (envFetchLevel <= userFetchLevel) {
                    logger.info(`Skipping timetable fetch for user ${user.id}: env level (${envFetchLevel}) <= user level (${userFetchLevel})`);
                } else {
                    try {
                        let hashMatch = user.timetableUrl.split('/');
                        hashMatch = (hashMatch[5] || '').split('?');
                        if (hashMatch && hashMatch[0]) {
                            const hash = hashMatch[0];
                            logger.info(`Extracted hash: ${JSON.stringify(hashMatch)}`);
                            const apiUrl = `https://timetableplus.xjtlu.edu.cn/ptapi/api/enrollment/hash/${hash}/activity?start=1&end=13`;
                            logger.info(`Requesting URL: ${apiUrl}`);
                            const response = await axios.get<TimetableActivity[]>(apiUrl);

                            if (response.status === 200 && Array.isArray(response.data)) {
                                logger.success(`Successfully fetched timetable data for user ${user.id}, found ${response.data.length} activities`);
                                await logUserEvent(user.id, 'timetableFetched', `Fetched timetable activities: ${response.data.length}`, { count: response.data.length });

                                const envLvl = parseInt(process.env.timetableFetchLevel || '0');
                                user.timetableFetchLevel = envLvl;
                                await dbService.updateUser(user);
                                logger.info(`Updated timetableFetchLevel for user ${user.id} to ${envLvl}`);

                                function parseWeekPattern(pattern: string): number[] {
                                    const weeks: number[] = [];
                                    if (!pattern) return weeks;
                                    const ranges = pattern.split(',');
                                    for (const range of ranges) {
                                        const trimmedRange = range.trim();
                                        if (trimmedRange.includes('-')) {
                                            const [start, end] = trimmedRange.split('-').map(Number);
                                            for (let i = start; i <= end; i++) weeks.push(i);
                                        } else {
                                            weeks.push(Number(trimmedRange));
                                        }
                                    }
                                    return weeks;
                                }

                                function getDayName(dayIndex: number): string {
                                    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                                    return days[dayIndex] || 'Unknown';
                                }

                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const nextWeekEnd = new Date(today);
                                nextWeekEnd.setDate(today.getDate() + 7);

                                for (const activity of response.data) {
                                    try {
                                        const weeks = parseWeekPattern(activity.weekPattern || '');
                                        const apiDay = activity.scheduledDay ? parseInt(activity.scheduledDay) : 0;
                                        const scheduledDay = apiDay === 6 ? 0 : apiDay + 1;
                                        const startTimeObj = activity.startTime ? new Date(activity.startTime) : new Date();
                                        const endTimeObj = activity.endTime ? new Date(activity.endTime) : new Date(Date.now() + 3600000);
                                        const currentDayOfWeek = today.getDay();
                                        let thisWeekCourseDate = new Date(today);
                                        const daysDifference = scheduledDay - currentDayOfWeek;
                                        if (daysDifference > 0) thisWeekCourseDate.setDate(today.getDate() + daysDifference);
                                        else if (daysDifference === 0) { /* today */ }
                                        else thisWeekCourseDate.setDate(today.getDate() + daysDifference);

                                        const potentialCourseDates: Date[] = [];
                                        if (thisWeekCourseDate >= today && thisWeekCourseDate <= nextWeekEnd) potentialCourseDates.push(thisWeekCourseDate);
                                        const nextWeekCourseDate = new Date(thisWeekCourseDate);
                                        nextWeekCourseDate.setDate(thisWeekCourseDate.getDate() + 7);
                                        if (nextWeekCourseDate <= nextWeekEnd) potentialCourseDates.push(nextWeekCourseDate);

                                        for (const courseDate of potentialCourseDates) {
                                            const courseStartTime = new Date(courseDate);
                                            courseStartTime.setHours(startTimeObj.getHours(), startTimeObj.getMinutes(), startTimeObj.getSeconds());
                                            const courseEndTime = new Date(courseDate);
                                            courseEndTime.setHours(endTimeObj.getHours(), endTimeObj.getMinutes(), endTimeObj.getSeconds());
                                            if (courseStartTime >= today) {
                                                const taskId = `timetable_${hash}_${activity.identity || uuidv4()}_${courseDate.toISOString().split('T')[0]}`;
                                                const existingTask = user.tasks.find(t => t.id === taskId);
                                                if (!existingTask) {
                                                    const currentWeekNumber = getCurrentWeekNumber();
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
                                                    try {
                                                        await dbService.addTask(user.id, newTask, !!user.conflictBoundaryInclusive);
                                                        broadcastTaskChange('created', newTask, user.id);
                                                        await dbService.refreshUserTasksIncremental(user, { addedIds: [newTask.id] });
                                                        logger.info(`Added timetable task: ${newTask.name} on ${courseDate.toLocaleDateString()} (Week: ${currentWeekNumber}) for user ${user.id}`);
                                                        await logUserEvent(user.id, 'taskCreated', `Created timetable task ${newTask.name}`, { id: newTask.id, startTime: newTask.startTime, endTime: newTask.endTime });
                                                    } catch (e: any) {
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
                            } else {
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
