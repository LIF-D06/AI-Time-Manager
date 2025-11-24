import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { dbService } from './dbService';
import { TimetableActivity } from './types';
import { ScheduleConflictError, findConflictingTasks } from './scheduleConflict';
import { broadcastTaskChange } from './websocket';
import { logUserEvent } from './userLog';
import { logger } from '../Utils/logger.js';
import { ExchangeClient } from './exchangeClient';

// Local definitions to avoid circular dependency with index.ts
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

export async function syncUserTimetable(user: User, force: boolean = false): Promise<{ added: number, errors: number }> {
    let addedCount = 0;
    let errorCount = 0;

    if (!user.ebridgeBinded || !user.timetableUrl) {
        throw new Error('User not bound to Ebridge or missing timetable URL');
    }

    const envFetchLevel = parseInt(process.env.timetableFetchLevel || '0');
    const userFetchLevel = user.timetableFetchLevel || 0;

    if (!force && envFetchLevel <= userFetchLevel) {
        logger.info(`Skipping timetable fetch for user ${user.id}: env level (${envFetchLevel}) <= user level (${userFetchLevel})`);
        return { added: 0, errors: 0 };
    }

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

                // Update fetch level only if successful
                const envLvl = parseInt(process.env.timetableFetchLevel || '0');
                user.timetableFetchLevel = envLvl;
                await dbService.updateUser(user);
                logger.info(`Updated timetableFetchLevel for user ${user.id} to ${envLvl}`);

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
                                        const conflicts = findConflictingTasks(user.tasks, newTask, { boundaryConflict: !!user.conflictBoundaryInclusive });

                                        await dbService.addTask(user.id, newTask, !!user.conflictBoundaryInclusive, true);
                                        broadcastTaskChange('created', newTask, user.id);
                                        await dbService.refreshUserTasksIncremental(user, { addedIds: [newTask.id] });
                                        
                                        if (conflicts.length > 0) {
                                            logger.warn(`Added conflicting timetable task ${newTask.id} for user ${user.id} with warning`);
                                            await logUserEvent(user.id, 'taskConflictWarning', `Added conflicting timetable task with warning: ${newTask.name}`, { id: newTask.id, conflicts: conflicts.map(c => c.id) });
                                        } else {
                                            logger.info(`Added timetable task: ${newTask.name} on ${courseDate.toLocaleDateString()} (Week: ${currentWeekNumber}) for user ${user.id}`);
                                            await logUserEvent(user.id, 'taskCreated', `Created timetable task ${newTask.name}`, { id: newTask.id, startTime: newTask.startTime, endTime: newTask.endTime });
                                        }
                                        addedCount++;
                                    } catch (e: any) {
                                        logger.error(`Failed to add timetable task ${newTask.id} for user ${user.id}:`, e);
                                        await logUserEvent(user.id, 'taskError', `Failed to add timetable task ${newTask.name}`, { id: newTask.id, error: (e as any)?.message });
                                        errorCount++;
                                    }
                                }
                            }
                        }
                    } catch (parseError) {
                        logger.error(`Error processing activity ${activity.identity || 'unknown'}:`, parseError);
                        await logUserEvent(user.id, 'timetableParseError', `Failed to process timetable activity`, { activityId: activity.identity || 'unknown', error: (parseError as any)?.message });
                        errorCount++;
                    }
                }
            } else {
                logger.warn(`Failed to fetch timetable for user ${user.id}`);
                await logUserEvent(user.id, 'timetableError', `Failed to fetch timetable`, {});
                throw new Error('Failed to fetch timetable data');
            }
        } else {
            logger.warn(`Failed to extract hash from timetableUrl for user ${user.id} `);
            await logUserEvent(user.id, 'timetableError', `Failed to extract timetable hash`, {});
            throw new Error('Invalid timetable URL format');
        }
    } catch (error) {
        logger.error(`Failed to process timetable for user ${user.id}:`, error);
        await logUserEvent(user.id, 'timetableError', `Failed to process timetable`, { error: (error as any)?.message });
        throw error;
    }

    return { added: addedCount, errors: errorCount };
}
