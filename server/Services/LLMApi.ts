import { logger } from '../Utils/logger.js';
import OpenAI from 'openai';
import Configuration from 'openai';
import { IEmail } from './types';
import { getOpenAITools } from './mcp';
import { MCPToolNames, type MCPToolNameTypes } from '../Services/mcpTypes.js';

// 定义邮件处理请求和响应接口
export interface EmailProcessRequest {
    email: IEmail;
    task: string;
}

export interface EmailProcessResponse {
    type: string; // 'meeting', 'todo', 'info', 'other'
    summary: string;
    action?: string;
    details?: {
        date?: string;
        time?: string;
        duration?: number;
        location?: string;
        attendees?: string[];
        priority?: 'high' | 'medium' | 'low';
        deadline?: string;
    };
}

export class LLMApi {
    private openai: OpenAI;
    private model: string;

    constructor(apiKey: string, model: string = 'deepseek-chat') {
        this.openai = new OpenAI({
            baseURL: process.env.API_BASE_URL,
            apiKey: apiKey,
        });
        this.model = model;
        logger.success(`OpenAI API 客户端初始化成功，使用模型: ${model}`);
    }

    /**
     * 处理邮件内容，通过OpenAI API分析邮件
     * @param email 邮件对象
     * @returns 分析结果
     */
    async processEmail(email: IEmail): Promise<any> {
        try {
            logger.exchange(`使用 LLM 处理邮件: ${email.subject}`);

            const prompt = this.generateEmailProcessingPrompt(email);

            const mcpTools = getOpenAITools();
            // Only use add_schedule from MCP tools for email processing
            const tools = [
                ...mcpTools.filter(t => {
                    switch(t.function.name) {
                        case MCPToolNames.AddSchedule:
                        // case MCPToolNames.UpdateSchedule:
                        // case MCPToolNames.GetSchedule:
                        // case MCPToolNames.GetServerTime:
                        // case MCPToolNames.SearchTasks:
                        // case MCPToolNames.ReadEmails:
                            return true;
                        default:
                            return false;
                    }
                }),
                {
                    type: "function",
                    function: {
                        name: "log_info",
                        description: "Log information from email that is purely informational and does not require a schedule or task.",
                        parameters: {
                            type: "object",
                            properties: {
                                summary: {
                                    type: "string",
                                    description: "Summary of the information",
                                },
                                importance: {
                                    type: "string",
                                    enum: ["high", "medium", "low"],
                                    description: "Importance level",
                                },
                            },
                            required: ["summary"],
                        },
                    },
                },
            ];

            const messages = [
                {
                    role: 'system',
                        content: `你是一个从邮件中提取日程信息专业的邮件分析助手。现在是 ${new Date().toISOString()}。
请分析邮件内容，并调用适当的工具来处理。
- 如果邮件包含会议、待办事项、截止日期或任何需要安排时间的内容，请先使用工具获得必要的信息，然后调用 'add_schedule'。
- 你必须从邮件中提取任务名称(name)、开始时间(startTime)和结束时间(endTime)。
- 如果邮件中只提到截止日期(Due date)，请将开始时间和结束时间设置为同一时间。
- 如果邮件仅包含信息通知，不需要采取行动，请调用 'log_info'。
- 确保提取的时间格式为 ISO 8601,使用中国上海时区。例如: 2023-03-15T10:00:00+08:00。`

                },
                {
                    role: 'user',
                    content: prompt
                }
            ];

            logger.data(`[LLM Request] Messages: ${JSON.stringify(messages, null, 2)}`);

            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: messages as any,
                tools: tools as any,
                tool_choice: "required",
                temperature: 0.3,
            });

            logger.data(`[LLM Response]: ${JSON.stringify(response, null, 2)}`);

            const message = response.choices[0].message;
            
            if (message.tool_calls && message.tool_calls.length > 0) {
                const toolCall = message.tool_calls[0] as any;
                logger.success(`邮件处理成功，触发工具调用: ${toolCall.function.name}`);
                return {
                    tool_calls: message.tool_calls
                };
            }

            logger.warn(`OpenAI API 未触发任何工具调用，返回默认信息`);
            return {
                tool_calls: [{
                    id: 'default',
                    type: 'function',
                    function: {
                        name: 'log_info',
                        arguments: JSON.stringify({
                            summary: '无法识别邮件类型或不需要操作',
                            importance: 'low'
                        })
                    }
                }]
            };

        } catch (error: any) {
            logger.error(`OpenAI API 调用失败: ${error.message || '未知错误'}`);
            // 返回默认错误处理
             return {
                tool_calls: [{
                    id: 'error',
                    type: 'function',
                    function: {
                        name: 'log_info',
                        arguments: JSON.stringify({
                            summary: '邮件分析失败',
                            importance: 'medium'
                        })
                    }
                }]
            };
        }
    }

    /**
     * 生成邮件处理提示词
     */
    private generateEmailProcessingPrompt(email: IEmail): string {
        // 简单的HTML清理，确保LLM能更好地理解内容
        let emailContent = email.body || '';
        // 移除script/style/head块
        emailContent = emailContent.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '');
        // 移除标签
        emailContent = emailContent.replace(/<[^>]+>/g, ' ');
        // 压缩空白
        emailContent = emailContent.replace(/\s+/g, ' ').trim();

        const emailSubject = email.subject || '';
        const from = email.from?.name || email.from?.address || '未知发件人';

        return `发件人: ${from}
主题: ${emailSubject}
内容: ${emailContent}

请分析上述邮件并调用相应的工具。`;
    }




    /**
     * 通用聊天接口，支持流式输出
     * @param messages 聊天消息历史
     * @param tools 可选的工具列表
     * @param onData 接收流式数据的回调函数
     */
    async chatStream(messages: any[], tools: any[] | undefined, onData: (data: { content?: string, tool_calls?: any[] }) => void): Promise<void> {
        try {
            logger.data(`[LLM Stream Request] Messages: ${JSON.stringify(messages, null, 2)}`);
            
            const stream = await this.openai.chat.completions.create({
                model: this.model,
                messages: messages,
                tools: tools,
                stream: true,
                temperature: 0.7,
            });

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (delta) {
                    const data: any = {};
                    if (delta.content) data.content = delta.content;
                    if (delta.tool_calls) data.tool_calls = delta.tool_calls;
                    
                    if (Object.keys(data).length > 0) {
                        onData(data);
                    }
                }
            }
        } catch (error: any) {
            logger.error(`OpenAI API 流式调用失败: ${error.message || '未知错误'}`);
            throw error;
        }
    }
}