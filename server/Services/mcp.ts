import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response } from 'express';
import { User } from '../index';
import { dbService } from './dbService';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../Utils/logger.js';
import { z } from 'zod';

// Store active transports: sessionId -> Transport
const transports = new Map<string, SSEServerTransport>();

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

        // 1. Read Emails
        server.tool(
            "read_emails",
            "Read recent emails from the user's inbox",
            {
                limit: z.number().optional().describe("Number of emails to read (default 5)"),
            },
            async ({ limit }) => {
                if (!user.emsClient) {
                    return { content: [{ type: "text", text: "Exchange client not initialized. Please wait for the background sync or check credentials." }] };
                }
                try {
                    const emails = await user.emsClient.findEmails(limit || 5);
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
                    return { content: [{ type: "text", text: JSON.stringify(emailSummaries, null, 2) }] };
                } catch (error: any) {
                    return { content: [{ type: "text", text: `Error reading emails: ${error.message}` }] };
                }
            }
        );

        // 2. Add Schedule
        server.tool(
            "add_schedule",
            "Add a new schedule/task",
            {
                name: z.string().describe("Title of the task"),
                startTime: z.string().describe("Start time in ISO 8601 format"),
                endTime: z.string().describe("End time in ISO 8601 format"),
                description: z.string().optional().describe("Description of the task"),
            },
            async ({ name, startTime, endTime, description }) => {
                const newTask = {
                    id: uuidv4(),
                    name,
                    startTime,
                    endTime,
                    dueDate: endTime,
                    description: description || '',
                    completed: false,
                    pushedToMSTodo: false
                };
                try {
                    await dbService.addTask(user.id, newTask, !!user.conflictBoundaryInclusive);
                    await dbService.refreshUserTasksIncremental(user, { addedIds: [newTask.id] });
                    return { content: [{ type: "text", text: `Task created successfully. ID: ${newTask.id}` }] };
                } catch (error: any) {
                    return { content: [{ type: "text", text: `Error creating task: ${error.message}` }] };
                }
            }
        );

        // 3. Delete Schedule
        server.tool(
            "delete_schedule",
            "Delete a schedule/task by ID",
            {
                taskId: z.string().describe("The ID of the task to delete"),
            },
            async ({ taskId }) => {
                try {
                    const success = await dbService.deleteTask(taskId);
                    if (success) {
                        await dbService.refreshUserTasksIncremental(user, { deletedIds: [taskId] });
                        return { content: [{ type: "text", text: `Task ${taskId} deleted successfully.` }] };
                    } else {
                        return { content: [{ type: "text", text: `Task ${taskId} not found or could not be deleted.` }] };
                    }
                } catch (error: any) {
                    return { content: [{ type: "text", text: `Error deleting task: ${error.message}` }] };
                }
            }
        );

        // 4. Update Schedule
        server.tool(
            "update_schedule",
            "Update an existing schedule/task",
            {
                taskId: z.string().describe("The ID of the task to update"),
                name: z.string().optional().describe("New title of the task"),
                startTime: z.string().optional().describe("New start time in ISO 8601 format"),
                endTime: z.string().optional().describe("New end time in ISO 8601 format"),
                description: z.string().optional().describe("New description of the task"),
                completed: z.boolean().optional().describe("Whether the task is completed"),
            },
            async ({ taskId, name, startTime, endTime, description, completed }) => {
                try {
                    const updates: any = {};
                    if (name !== undefined) updates.name = name;
                    if (startTime !== undefined) updates.startTime = startTime;
                    if (endTime !== undefined) updates.endTime = endTime;
                    if (description !== undefined) updates.description = description;
                    if (completed !== undefined) updates.completed = completed;

                    if (Object.keys(updates).length === 0) {
                        return { content: [{ type: "text", text: "No updates provided." }] };
                    }

                    const updatedTask = await dbService.patchTask(user.id, taskId, updates, !!user.conflictBoundaryInclusive);
                    await dbService.refreshUserTasksIncremental(user, { updatedIds: [taskId] });
                    
                    return { content: [{ type: "text", text: `Task ${taskId} updated successfully.` }] };
                } catch (error: any) {
                    return { content: [{ type: "text", text: `Error updating task: ${error.message}` }] };
                }
            }
        );

        // 5. Get Schedule
        server.tool(
            "get_schedule",
            "Get schedules within a time range",
            {
                startDate: z.string().describe("Start date in ISO 8601 format"),
                endDate: z.string().describe("End date in ISO 8601 format"),
            },
            async ({ startDate, endDate }) => {
                try {
                    const { tasks } = await dbService.getTasksPage(user.id, {
                        start: startDate,
                        end: endDate,
                        limit: 100
                    });
                    return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
                } catch (error: any) {
                    return { content: [{ type: "text", text: `Error fetching schedule: ${error.message}` }] };
                }
            }
        );

        // 6. Get Server Time
        server.tool(
            "get_server_time",
            "Get the current server time",
            {},
            async () => {
                return { content: [{ type: "text", text: new Date().toISOString() }] };
            }
        );

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
