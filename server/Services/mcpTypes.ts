import type { Task } from '../index';
import type { RecurrenceRule, ScheduleType } from './types';

// 基础内容类型（目前工具主要返回 text）
export type ToolTextContent = { type: 'text'; text: string };

// 通用工具返回结构（保守建模，允许额外字段）
export interface ToolResult {
    content: ToolTextContent[];
    // 可选的额外字段，具体工具可细化
    task?: Task;
    recurrenceSummary?: any;
    conflictWarning?: any;
    queued?: true;
    queueId?: string;
    [key: string]: any;
}

// read_emails
export interface ReadEmailsArgs {
    limit?: number;
}
export type ReadEmailsResult = ToolResult;

// add_schedule
export interface AddScheduleArgs {
    name: string;
    startTime?: string;
    endTime?: string;
    description?: string;
    recurrenceRule?: RecurrenceRule;
    location?: string;
    type?: 'meeting' | 'todo';
    importance?: 'high' | 'normal' | 'low';
    isReminderOn?: boolean;
    scheduleType?: ScheduleType;
    // internal flag used by server to bypass enqueue/approval
    _internal_approve?: boolean;
}

export interface AddScheduleSuccessResult extends ToolResult {
    task: Task;
}
export interface AddScheduleQueuedResult extends ToolResult {
    queued: true;
    queueId: string;
}
export type AddScheduleResult = AddScheduleSuccessResult | AddScheduleQueuedResult | ToolResult;

// delete_schedule
export interface DeleteScheduleArgs {
    taskId: string;
}
export type DeleteScheduleResult = ToolResult;

// update_schedule
export interface UpdateScheduleArgs {
    taskId: string;
    name?: string;
    startTime?: string;
    endTime?: string;
    description?: string;
    completed?: boolean;
}
export type UpdateScheduleResult = ToolResult;

// get_schedule
export interface GetScheduleArgs {
    startDate: string;
    endDate: string;
}
export type GetScheduleResult = ToolResult;

// get_server_time
export interface GetServerTimeArgs { }
export type GetServerTimeResult = ToolResult;

// search_tasks
export interface SearchTasksArgs {
    q?: string;
    completed?: boolean;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'startTime' | 'dueDate' | 'name' | 'endTime';
    order?: 'asc' | 'desc';
}
export interface SearchTasksResultBody {
    tasks: Task[];
    total: number;
}
export type SearchTasksResult = ToolResult & { _parsed?: SearchTasksResultBody };

// 工具名称集合与通用签名

export const enum MCPToolNames {
    ReadEmails = 'read_emails',
    AddSchedule = 'add_schedule',
    DeleteSchedule = 'delete_schedule',
    UpdateSchedule = 'update_schedule',
    GetSchedule = 'get_schedule',
    GetServerTime = 'get_server_time',
    SearchTasks = 'search_tasks',
}


export type MCPToolNameTypes =
    | MCPToolNames.ReadEmails
    | MCPToolNames.AddSchedule
    | MCPToolNames.DeleteSchedule
    | MCPToolNames.UpdateSchedule
    | MCPToolNames.GetSchedule
    | MCPToolNames.GetServerTime
    | MCPToolNames.SearchTasks;

export type MCPToolExecuteFn<Args = any, Res = ToolResult> = (args: Args, user: any) => Promise<Res>;

export interface MCPToolDefinition<Args = any, Res = ToolResult> {
    name: MCPToolNames | string;
    description?: string;
    schema?: any;
    execute: MCPToolExecuteFn<Args, Res>;
}

export type MCPToolsMap = Record<string, MCPToolDefinition>;

export default {} as const;
