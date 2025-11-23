import axios from "axios";
import { logger } from "../Utils/logger.js";
import { Task } from ".././index";



export async function createTodoItem(task: Task, token: string): Promise<void> {
    try {
        const msToken = token;
        const graphEndpoint = `https://graph.microsoft.com/v1.0/me/todo/lists`;
        const headers = { Authorization: `Bearer ${msToken}`, 'Content-Type': 'application/json' };
        
        // 使用 async/await 替代链式调用，更好地处理错误
        const createListResponse = await axios.post(graphEndpoint, {
            displayName: task.name
        }, { headers });
        
        const listsRes = await axios.get(graphEndpoint, { headers });
        const defaultList = listsRes.data.value.find((l: any) => l.wellknownName === 'defaultList') || listsRes.data.value[0];
        
        if (!defaultList) throw new Error('No list found');
        
        const payload: any = {
            title: task.name,
            body: { content: task.description || '', contentType: 'text' },
            dueDateTime: { dateTime: task.dueDate, timeZone: 'UTC' },
            importance: task.importance || 'normal',
            status: task.completed ? 'completed' : 'notStarted'
        };

        if (task.isReminderOn && task.startTime) {
            payload.reminderDateTime = { dateTime: task.startTime, timeZone: 'UTC' };
        }

        const taskResponse = await axios.post(`https://graph.microsoft.com/v1.0/me/todo/lists/${defaultList.id}/tasks`, payload, { headers });
        
        if (taskResponse.data) {
            task.pushedToMSTodo = true;
            logger.success(`Pushed task ${task.id} to MS Todo`);
        }
        
    } catch (error: any) {
        if (error.response?.status === 401) {
            logger.error(`MS Graph API 401 Unauthorized for task ${task.id}: Token may be expired or invalid`);
        } else if (error.response?.status === 403) {
            logger.error(`MS Graph API 403 Forbidden for task ${task.id}: Insufficient permissions`);
        } else if (error.response?.status) {
            logger.error(`MS Graph API ${error.response.status} error for task ${task.id}:`, error.response.data || error.message);
        } else {
            logger.error(`创建待办事项失败: ${error.message || '未知错误'}`);
        }
        // 不抛出错误，避免影响主流程
    }
}