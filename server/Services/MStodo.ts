import axios from "axios";
import { logger } from "../Utils/logger.js";
import { Task } from ".././index";



export async function createTodoItem(task: Task, token: string): Promise<void> {
    try {
        const msToken = token;
                const graphEndpoint = `https://graph.microsoft.com/v1.0/me/todo/lists`;
                const headers = { Authorization: `Bearer ${msToken}`, 'Content-Type': 'application/json' };
                axios.post(graphEndpoint, {
                    displayName: task.name
                }, { headers }).then(() => {
                    return axios.get(graphEndpoint, { headers });
                }).then((listsRes) => {
                    const defaultList = listsRes.data.value.find((l: any) => l.wellknownName === 'defaultList') || listsRes.data.value[0];
                    if (!defaultList) throw new Error('No list found');
                    return axios.post(`https://graph.microsoft.com/v1.0/me/todo/lists/${defaultList.id}/tasks`, {
                        title: task.name,
                        body: { content: task.description || '', contentType: 'text' },
                        dueDateTime: { dateTime: task.dueDate, timeZone: 'UTC' },
                        importance: 'normal',
                        status: task.completed ? 'completed' : 'notStarted'
                    }, { headers });
                }).then((response) => {
                    return response.data;
                }).then((response) => {
                    if (response) {
                        task.pushedToMSTodo = true;
                        logger.success(`Pushed task ${task.id} to MS Todo`);
                    }
                });
    } catch (error: any) {
        logger.error(`创建待办事项失败: ${error.message || '未知错误'}`);
    }
}