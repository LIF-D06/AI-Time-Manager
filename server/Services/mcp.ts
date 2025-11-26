import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response } from 'express';
import type { User, Task } from '../index';
import type { RecurrenceRule, ScheduleType } from './types';
import { resolveScheduleType, scheduleTypeValues } from './types.js';
import { dbService } from './dbService';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../Utils/logger.js';
import { z } from 'zod';
import { IEvent } from './types';
import { findConflictingTasks, TimeLikeTask } from './scheduleConflict';
import { logUserEvent } from './userLog';
import { generateRecurrenceInstances, buildRecurrenceSummary } from './recurrence';
import { broadcastTaskChange } from './websocket';
import type { MCPToolsMap, MCPToolDefinition, AddScheduleArgs, AddScheduleResult, ReadEmailsArgs, ReadEmailsResult } from './mcpTypes';

// Store active transports: sessionId -> Transport
const transports = new Map<string, SSEServerTransport>();

export const mcpTools: MCPToolsMap = {
    read_emails: {
        name: "read_emails",
        description: "Read recent emails from the user's inbox",
        schema: {
            limit: z.number().optional().describe("Number of emails to read (default 5)"),
        },
        execute: async (args: { limit?: number }, user: User) => {
            if (!user.emsClient) {
                return { content: [{ type: "text" as const, text: "Exchange client not initialized. Please wait for the background sync or check credentials." }] };
            }
            try {
                const emails = await user.emsClient.findEmails(args.limit || 5);
                // Fetch full content for each email to get the body
                const fullEmails = await Promise.all(emails.map(async (e) => {
                    try {
                        return await user.emsClient!.getEmailById(e.id);
                    } catch (err) {
                        return e; // Return basic info if fetch fails
                    }
                }));
                //删去邮件body中的html
                

                const emailSummaries = fullEmails.map(e => ({
                    subject: e.subject,
                    sender: e.from ? e.from.name : 'Unknown',
                    body: e.body 
                }));
                return { content: [{ type: "text" as const, text: JSON.stringify(emailSummaries, null, 2) }] };
            } catch (error: any) {
                return { content: [{ type: "text" as const, text: `Error reading emails: ${error.message}` }] };
            }
        }
    },
    add_schedule: {
        name: "add_schedule",
        description: "Add a new schedule/task based on the email content. You MUST extract the task name and time information.",
        schema: {
            name: z.string().describe("The title of the task, extracted from the email subject or content. MUST be provided."),
            startTime: z.string().optional().describe("Start time in ISO 8601 format (e.g. 2023-10-01T09:00:00+08:00). If timezone is not specified in the email, assume China Standard Time (UTC+8)."),
            endTime: z.string().optional().describe("End time in ISO 8601 format. If a duration is mentioned, calculate it. If a due date is mentioned, use that. Assume UTC+8 if not specified."),
            description: z.string().optional().describe("Detailed description of the task, including any relevant content from the email body."),
            recurrenceRule: z.any().optional().describe("Optional recurrence rule object, supports freq 'daily'|'weekly'|'weeklyByWeekNumber'|'dailyOnDays'"),
            location: z.string().optional().describe("Location of the event"),
            type: z.enum(["meeting", "todo"]).optional().describe("Type of the schedule"),
            importance: z.enum(["high", "normal", "low"]).optional().describe("Importance of the task"),
            isReminderOn: z.boolean().optional().describe("Whether to set a reminder"),
            scheduleType: z.enum(scheduleTypeValues as unknown as [ScheduleType, ...ScheduleType[]]).optional().describe("Explicit schedule type metadata controlling recurrence behavior"),
        },
        execute: async (args: { name: string, startTime?: string, endTime?: string, description?: string, location?: string, type?: string, importance?: 'high' | 'normal' | 'low', isReminderOn?: boolean, recurrenceRule?: RecurrenceRule, scheduleType?: ScheduleType }, user: User) => {
            let { name, startTime, endTime, description, location, importance, isReminderOn, recurrenceRule, scheduleType } = args;
            
            if (!name) {
                return { content: [{ type: "text" as const, text: "Error: Task name is required." }] };
            }

            // Helper to ensure timezone
            const ensureTimezone = (timeStr: string) => {
                if (!timeStr) return timeStr;
                // Check if it has timezone info (Z or +HH:MM or -HH:MM)
                if (!/Z|[+-]\d{2}:?\d{2}$/.test(timeStr)) {
                    return `${timeStr}+08:00`;
                }
                return timeStr;
            };

            if (startTime) startTime = ensureTimezone(startTime);
            if (endTime) endTime = ensureTimezone(endTime);

            // Default time logic
            if (!startTime) startTime = new Date().toISOString();
            if (!endTime) {
                const start = new Date(startTime);
                start.setHours(start.getHours() + 1);
                endTime = start.toISOString();
            }

            // Validate dates
            const isValidDate = (d: string) => !isNaN(new Date(d).getTime());
            if (!isValidDate(startTime) || !isValidDate(endTime)) {
                return { content: [{ type: "text" as const, text: `Error: Invalid date format. Start=${startTime}, End=${endTime}` }] };
            }

            let parsedRecurrence: RecurrenceRule | undefined;
            let resolvedScheduleType: ScheduleType;
            try {
                const resolved = resolveScheduleType({ explicit: scheduleType, recurrence: recurrenceRule, fallback: 'single' });
                parsedRecurrence = resolved.parsedRecurrence;
                resolvedScheduleType = resolved.scheduleType;
            } catch (err: any) {
                const msg = err?.message?.includes('recurrenceRule') ? 'Invalid recurrenceRule value' : 'Invalid scheduleType value';
                return { content: [{ type: "text" as const, text: msg }] };
            }

            const resolvedRecurrenceRule = parsedRecurrence ?? recurrenceRule;

            // Check for conflicts
            let parentConflicts: any[] = [];
            try {
                // Fetch existing tasks in the time range
                const { tasks: existingTasks } = await dbService.getTasksPage(user.id, {
                    start: startTime,
                    end: endTime,
                    limit: 100
                });

                const candidate: TimeLikeTask = {
                    id: 'new-task',
                    startTime: startTime,
                    endTime: endTime
                };

                parentConflicts = findConflictingTasks(existingTasks, candidate, { boundaryConflict: !!user.conflictBoundaryInclusive });

                if (parentConflicts.length > 0 && !resolvedRecurrenceRule) {
                    const conflictNames = parentConflicts.map(t => t.name).join(', ');
                    const message = `Schedule conflict detected with: ${conflictNames}`;
                    
                    // Trigger user log event
                    await logUserEvent(user.id, 'schedule_conflict', message, {
                        candidate: { name, startTime, endTime },
                        conflicts: parentConflicts
                    });

                    return { content: [{ type: "text" as const, text: `Task creation skipped due to conflict with: ${conflictNames}. A notification has been sent.` }] };
                }
            } catch (err) {
                logger.error(`Error checking conflicts: ${err}`);
            }

                const newTask: Task = {
                id: uuidv4(),
                name,
                startTime,
                endTime,
                dueDate: endTime,
                description: description || '',
                location: location || '',
                completed: false,
                pushedToMSTodo: false,
                scheduleType: resolvedScheduleType,
                importance: importance || 'normal',
                isReminderOn: isReminderOn
            };
            // If caller explicitly sets _internal_approve, proceed to create directly (used by server APIs)
            if ((args as any)._internal_approve === true) {
                try {
                    // If recurrenceRule provided, attach serialized rule to parent task
                    if (resolvedRecurrenceRule) newTask.recurrenceRule = JSON.stringify(resolvedRecurrenceRule);

                    await dbService.addTask(user.id, newTask, !!user.conflictBoundaryInclusive, user.isConflictScheduleAllowed);
                    await dbService.refreshUserTasksIncremental(user, { addedIds: [newTask.id] });
                    broadcastTaskChange('created', newTask as Task, user.id);

                    // Sync to Exchange Calendar if emsClient is available (parent only)
                    if (user.emsClient) {
                        const eventData: IEvent = {
                            subject: newTask.name,
                            body: newTask.description,
                            start: newTask.startTime,
                            end: newTask.endTime,
                            location: newTask.location || '',
                            attendees: [],
                            importance: newTask.importance,
                            isReminderOn: newTask.isReminderOn
                        };
                        try {
                            await user.emsClient.createEvent(eventData);
                            logger.success(`Task synced to Exchange Calendar: ${newTask.name}`);
                        } catch (exchangeError: any) {
                            logger.error(`Failed to sync task to Exchange Calendar: ${exchangeError.message}`);
                        }
                    }

                    // If recurrence rule is present, generate instances and insert them
                    if (resolvedRecurrenceRule) {
                        const generated = generateRecurrenceInstances(newTask as Task, resolvedRecurrenceRule as RecurrenceRule);
                        const createdIds: string[] = [newTask.id];
                        const instanceConflicts: any[] = [];
                        let createdChildren = 0, errorChildren = 0;

                        for (const inst of generated) {
                            try {
                                const instConf = findConflictingTasks(user.tasks || [], inst, { boundaryConflict: !!user.conflictBoundaryInclusive });
                                if (instConf.length > 0) {
                                    instanceConflicts.push({ instance: { id: inst.id, startTime: inst.startTime, endTime: inst.endTime }, conflicts: instConf.map(c => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime })) });
                                    await logUserEvent(user.id, 'taskConflict', `Created recurrence instance with conflict ${inst.name}`, { parentId: newTask.id, instanceStart: inst.startTime, instanceEnd: inst.endTime });
                                } else {
                                    await logUserEvent(user.id, 'taskCreated', `Created recurrence instance ${inst.name}`, { id: inst.id, parentTaskId: inst.parentTaskId, startTime: inst.startTime, endTime: inst.endTime });
                                }

                                await dbService.addTask(user.id, inst, !!user.conflictBoundaryInclusive, user.isConflictScheduleAllowed);
                                createdChildren++;
                                createdIds.push(inst.id);
                                broadcastTaskChange('created', inst as Task, user.id);

                                // Sync instance to Exchange as separate event if desired
                                if (user.emsClient) {
                                    const ev: IEvent = {
                                        subject: inst.name,
                                        body: inst.description,
                                        start: inst.startTime,
                                        end: inst.endTime,
                                        location: inst.location || '',
                                        attendees: [],
                                        importance: inst.importance,
                                        isReminderOn: inst.isReminderOn
                                    };
                                    try { await user.emsClient.createEvent(ev); } catch (e) { /* ignore */ }
                                }
                            } catch (e: any) {
                                errorChildren++;
                                await logUserEvent(user.id, 'taskError', `Error creating recurrence instance for ${newTask.name}`, { parentId: newTask.id, error: e?.message });
                            }
                        }

                        // Refresh cache with all created ids
                        await dbService.refreshUserTasksIncremental(user, { addedIds: createdIds });

                        return {
                            content: [{ type: "text" as const, text: `Task created successfully. ID: ${newTask.id}. Instances created: ${createdChildren}` }],
                            task: newTask,
                            recurrenceSummary: buildRecurrenceSummary(resolvedRecurrenceRule as RecurrenceRule, createdChildren, 0, errorChildren),
                            conflictWarning: (parentConflicts.length > 0 || instanceConflicts.length > 0) ? {
                                message: 'Task created with time conflicts',
                                conflicts: parentConflicts.map((c: any) => ({ id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime })),
                                instanceConflicts
                            } : undefined
                        };
                    }

                    return { 
                        content: [{ type: "text" as const, text: `Task created successfully. ID: ${newTask.id}` }],
                        task: newTask 
                    };
                } catch (error: any) {
                    return { content: [{ type: "text" as const, text: `Error creating task: ${error.message}` }] };
                }
            }

            // Otherwise (normal external MCP caller), enqueue request and notify user for approval
            try {
                const db = dbService;
                const rawRequest = JSON.stringify({ args, timestamp: new Date().toISOString() });
                const queueId = await db.addScheduleToQueue(user.id, rawRequest);
                // Log user event and broadcast to connected clients
                await logUserEvent(user.id, 'external_schedule_request', `外部请求创建日程: ${name}`, { queueId, name, startTime, endTime });
                return { content: [{ type: "text" as const, text: `Request queued for user approval. Queue ID: ${queueId}` }], queued: true, queueId };
            } catch (err: any) {
                logger.error('Failed to enqueue external schedule request:', err);
                return { content: [{ type: "text" as const, text: `Failed to queue request: ${err?.message || err}` }] };
            }
        }
    },
    delete_schedule: {
        name: "delete_schedule",
        description: "Delete a schedule/task by ID",
        schema: {
            taskId: z.string().describe("The ID of the task to delete"),
        },
        execute: async (args: { taskId: string }, user: User) => {
            try {
                const success = await dbService.deleteTask(args.taskId);
                if (success) {
                    await dbService.refreshUserTasksIncremental(user, { deletedIds: [args.taskId] });
                    return { content: [{ type: "text" as const, text: `Task ${args.taskId} deleted successfully.` }] };
                } else {
                    return { content: [{ type: "text" as const, text: `Task ${args.taskId} not found or could not be deleted.` }] };
                }
            } catch (error: any) {
                return { content: [{ type: "text" as const, text: `Error deleting task: ${error.message}` }] };
            }
        }
    },
    update_schedule: {
        name: "update_schedule",
        description: "Update an existing schedule/task",
        schema: {
            taskId: z.string().describe("The ID of the task to update"),
            name: z.string().optional().describe("New title of the task"),
            startTime: z.string().optional().describe("New start time in ISO 8601 format"),
            endTime: z.string().optional().describe("New end time in ISO 8601 format"),
            description: z.string().optional().describe("New description of the task"),
            completed: z.boolean().optional().describe("Whether the task is completed"),
        },
        execute: async (args: { taskId: string, name?: string, startTime?: string, endTime?: string, description?: string, completed?: boolean }, user: User) => {
            try {
                const updates: any = {};
                if (args.name !== undefined) updates.name = args.name;
                if (args.startTime !== undefined) updates.startTime = args.startTime;
                if (args.endTime !== undefined) updates.endTime = args.endTime;
                if (args.description !== undefined) updates.description = args.description;
                if (args.completed !== undefined) updates.completed = args.completed;

                if (Object.keys(updates).length === 0) {
                    return { content: [{ type: "text" as const, text: "No updates provided." }] };
                }

                const updatedTask = await dbService.patchTask(user.id, args.taskId, updates, !!user.conflictBoundaryInclusive);
                await dbService.refreshUserTasksIncremental(user, { updatedIds: [args.taskId] });
                
                return { content: [{ type: "text" as const, text: `Task ${args.taskId} updated successfully.` }] };
            } catch (error: any) {
                return { content: [{ type: "text" as const, text: `Error updating task: ${error.message}` }] };
            }
        }
    },
    get_schedule: {
        name: "get_schedule",
        description: "Get schedules within a time range",
        schema: {
            startDate: z.string().describe("Start date in ISO 8601 format"),
            endDate: z.string().describe("End date in ISO 8601 format"),
        },
        execute: async (args: { startDate: string, endDate: string }, user: User) => {
            try {
                const { tasks } = await dbService.getTasksPage(user.id, {
                    start: args.startDate,
                    end: args.endDate,
                    limit: 100
                });
                return { content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }] };
            } catch (error: any) {
                return { content: [{ type: "text" as const, text: `Error fetching schedule: ${error.message}` }] };
            }
        }
    },
    get_server_time: {
        name: "get_server_time",
        description: "Get the current server time. IMPORTANT:You MUST use this tool to get the current time before scheduling any time related tasks to ensure accurate time references IF there are no time source in the context.",
        schema: {},
        execute: async (args: any, user: User) => {
            return { content: [{ type: "text" as const, text: new Date().toISOString() }] };
        }
    },
    search_tasks: {
        name: "search_tasks",
        description: "Search for tasks with various filters",
        schema: {
            q: z.string().optional().describe("Fuzzy search query for task name or description"),
            completed: z.boolean().optional().describe("Filter by completion status"),
            startDate: z.string().optional().describe("Filter tasks ending after this date (ISO 8601)"),
            endDate: z.string().optional().describe("Filter tasks starting before this date (ISO 8601)"),
            limit: z.number().optional().describe("Max number of results (default 50)"),
            offset: z.number().optional().describe("Pagination offset (default 0)"),
            sortBy: z.enum(["startTime", "dueDate", "name", "endTime"]).optional().describe("Field to sort by"),
            order: z.enum(["asc", "desc"]).optional().describe("Sort order")
        },
        execute: async (args: { q?: string, completed?: boolean, startDate?: string, endDate?: string, limit?: number, offset?: number, sortBy?: string, order?: 'asc' | 'desc' }, user: User) => {
            try {
                const { tasks, total } = await dbService.getTasksPage(user.id, {
                    q: args.q,
                    completed: args.completed,
                    start: args.startDate,
                    end: args.endDate,
                    limit: args.limit,
                    offset: args.offset,
                    sortBy: args.sortBy,
                    order: args.order
                });
                return { content: [{ type: "text" as const, text: JSON.stringify({ tasks, total }, null, 2) }] };
            } catch (error: any) {
                return { content: [{ type: "text" as const, text: `Error searching tasks: ${error.message}` }] };
            }
        }
    },
};

export function initializeMcpRoutes(app: express.Application, authenticateToken: any) {
    
    // SSE Endpoint to start a session
    app.get('/api/mcp/sse', authenticateToken, async (req: any, res: Response) => {
        const user = req.user as User;
        if (!user) {
            res.status(401).send('User not found');
            return;
        }

        logger.info(`Starting MCP session for user ${user.id}`);

        const transport = new SSEServerTransport(
            '/api/mcp/messages', 
            res
        );

        const server = new McpServer({
            name: "TimeManager MCP",
            version: "1.0.0"
        });

        // Register tools from mcpTools definition
        for (const key of Object.keys(mcpTools)) {
            const tool = mcpTools[key as keyof typeof mcpTools];
            server.tool(
                    tool.name,
                    tool.description ?? '',
                    tool.schema ?? {},
                    async (args: any) => {
                        return await tool.execute(args, user);
                    }
                );
        }

        await server.connect(transport);
        
        // Store transport by sessionId (SSEServerTransport generates a sessionId)
        // We need to access the sessionId from the transport. 
        // Note: The SDK's SSEServerTransport might not expose sessionId publicly in all versions, 
        // but usually it's available or we can infer it from the URL it sends to the client.
        // Actually, the transport handles the response and keeps it open.
        // We need to intercept the session ID creation or rely on the client sending it back.
        // The SSEServerTransport sends an 'endpoint' event with the URI to post to.
        // That URI usually includes the session ID.
        
        // For this implementation, we'll assume the transport manages its own session mapping if we use the handlePostMessage correctly.
        // Wait, `handlePostMessage` is a method on the transport instance.
        // So we need to map `sessionId` -> `transport instance`.
        // But we don't know the sessionId until the transport generates it.
        // Let's look at how we can capture it.
        // The `SSEServerTransport` writes to `res`.
        // We can't easily intercept the session ID unless we subclass or if it's a property.
        
        // Workaround: We'll use a custom session ID generation if the SDK allows, or we'll just store it if we can read it.
        // If `transport.sessionId` exists, we use it.
        
        const sessionId = (transport as unknown as { sessionId?: string }).sessionId;
        if (sessionId) {
            transports.set(sessionId, transport);
            
            // Clean up on close
            res.on('close', () => {
                transports.delete(sessionId);
                logger.info(`MCP session ${sessionId} closed`);
            });
        } else {
            logger.warn("Could not capture MCP session ID");
        }
    });

    // Endpoint to handle client messages (POST)
    app.post('/api/mcp/messages', async (req: Request, res: Response) => {
        const sessionId = req.query.sessionId as string;
        if (!sessionId) {
            res.status(400).send("Missing sessionId");
            return;
        }

        const transport = transports.get(sessionId);
        if (!transport) {
            res.status(404).send("Session not found");
            return;
        }

        await transport.handlePostMessage(req, res);
    });
}

export function getOpenAITools() {
    const tools = [];
    for (const key in mcpTools) {
        const tool = mcpTools[key as keyof typeof mcpTools];
        const parameters: any = {
            type: "object",
            properties: {},
            required: []
        };
        
        // Helper to extract Zod schema details
        // Note: This is a simplified converter for the specific Zod schemas used here.
        // It may not cover all Zod features.
        // Handle both ZodObject (has .shape) and plain object definitions
        // tool.schema may be a Zod object with `.shape` or a plain object; handle both
        const schemaLike = tool.schema as { shape?: Record<string, any> } | Record<string, any>;
        const shape = (schemaLike && (schemaLike as any).shape) ? (schemaLike as any).shape : tool.schema;
        
        if (shape) {
            for (const paramName in shape) {
                const zodSchema = shape[paramName];
                let schema = zodSchema;
                let isOptional = false;
                
                // Handle ZodOptional
                if (schema._def.typeName === 'ZodOptional') {
                    isOptional = true;
                    schema = schema._def.innerType;
                }
                
                const prop: any = {};
                if (schema.description) prop.description = schema.description;
                
                if (schema._def.typeName === 'ZodString') {
                    prop.type = "string";
                } else if (schema._def.typeName === 'ZodNumber') {
                    prop.type = "number";
                } else if (schema._def.typeName === 'ZodBoolean') {
                    prop.type = "boolean";
                } else if (schema._def.typeName === 'ZodEnum') {
                    prop.type = "string";
                    prop.enum = schema._def.values;
                }
                
                parameters.properties[paramName] = prop;
                if (!isOptional) {
                    parameters.required.push(paramName);
                }
            }
        }
        
        tools.push({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: parameters
            }
        });
    }
    logger.data(`Generated OpenAI Tools: ${JSON.stringify(tools, null, 2)}`);
    return tools;
}
