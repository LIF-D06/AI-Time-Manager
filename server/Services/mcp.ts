import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response } from 'express';
import type { User } from '../index';
import { dbService } from './dbService';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../Utils/logger.js';
import { z } from 'zod';
import { IEvent } from './types';

// Store active transports: sessionId -> Transport
const transports = new Map<string, SSEServerTransport>();

export const mcpTools = {
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
                
                const emailSummaries = fullEmails.map(e => ({
                    subject: e.subject,
                    sender: e.from ? e.from.name : 'Unknown',
                    body: e.body ? e.body.substring(0, 500) + (e.body.length > 500 ? '...' : '') : 'No content'
                }));
                return { content: [{ type: "text" as const, text: JSON.stringify(emailSummaries, null, 2) }] };
            } catch (error: any) {
                return { content: [{ type: "text" as const, text: `Error reading emails: ${error.message}` }] };
            }
        }
    },
    add_schedule: {
        name: "add_schedule",
        description: "Add a new schedule/task",
        schema: {
            name: z.string().describe("Title of the task"),
            startTime: z.string().optional().describe("Start time in ISO 8601 format. Defaults to now if not provided."),
            endTime: z.string().optional().describe("End time in ISO 8601 format. Defaults to 1 hour after start time."),
            description: z.string().optional().describe("Description of the task"),
            location: z.string().optional().describe("Location of the event"),
            type: z.enum(["meeting", "todo"]).optional().describe("Type of the schedule"),
            importance: z.enum(["high", "normal", "low"]).optional().describe("Importance of the task"),
            isReminderOn: z.boolean().optional().describe("Whether to set a reminder"),
        },
        execute: async (args: { name: string, startTime?: string, endTime?: string, description?: string, location?: string, type?: string, importance?: 'high' | 'normal' | 'low', isReminderOn?: boolean }, user: User) => {
            let { name, startTime, endTime, description, location, importance, isReminderOn } = args;
            
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

            const newTask = {
                id: uuidv4(),
                name,
                startTime,
                endTime,
                dueDate: endTime,
                description: description || '',
                location: location || '',
                completed: false,
                pushedToMSTodo: false,
                importance: importance || 'normal',
                isReminderOn: isReminderOn
            };
            try {
                await dbService.addTask(user.id, newTask, !!user.conflictBoundaryInclusive);
                await dbService.refreshUserTasksIncremental(user, { addedIds: [newTask.id] });

                // Sync to Exchange Calendar if emsClient is available
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
                        // Don't fail the whole operation if exchange sync fails, but maybe warn
                    }
                }

                return { 
                    content: [{ type: "text" as const, text: `Task created successfully. ID: ${newTask.id}` }],
                    task: newTask 
                };
            } catch (error: any) {
                return { content: [{ type: "text" as const, text: `Error creating task: ${error.message}` }] };
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
        description: "Get the current server time",
        schema: {},
        execute: async (args: any, user: User) => {
            return { content: [{ type: "text" as const, text: new Date().toISOString() }] };
        }
    }
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
                tool.description,
                tool.schema,
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
        
        const sessionId = (transport as any).sessionId;
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
        const shape = (tool.schema as any).shape;
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
    return tools;
}
