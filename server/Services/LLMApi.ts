import { logger } from '../Utils/logger.js';
import OpenAI from 'openai';
import Configuration from 'openai';
import { IEmail } from './types';

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
    async processEmail(email: IEmail): Promise<EmailProcessResponse> {
        try {
            logger.exchange(`使用 OpenAI API 处理邮件: ${email.subject}`);

            const prompt = this.generateEmailProcessingPrompt(email);

            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个专业的邮件分析助手，能够准确识别邮件内容类型并提取关键信息。'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                response_format: {
                    type: 'json_object'
                },
                temperature: 0.3,
            });

            const data = response;
            if (!data.choices || data.choices.length === 0 || !data.choices[0].message?.content) {
                throw new Error('OpenAI API 返回空响应');
            }

            const result = JSON.parse(data.choices[0].message.content);
            logger.success(`邮件处理成功，识别类型: ${result.type}`);
            return result;
        } catch (error: any) {
            logger.error(`OpenAI API 调用失败: ${error.message || '未知错误'}`);
            // 返回默认值以保证系统继续运行
            return {
                type: 'other',
                summary: '无法分析邮件内容',
                action: 'manual_review'
            };
        }
    }

    /**
     * 生成邮件处理提示词
     */
    private generateEmailProcessingPrompt(email: IEmail): string {
        const emailContent = email.body || '';
        const emailSubject = email.subject || '';
        logger.exchange(`邮件主题: ${emailSubject}`);
        // 不再输出邮件内容，避免控制台过载
        const from = email.from?.name || email.from?.address || '未知发件人';

        return `请分析以下邮件，并按照指定的JSON格式返回分析结果：

发件人: ${from}
主题: ${emailSubject}
内容: ${emailContent}

请识别邮件类型（会议邀请、待办事项、信息通知或其他），并提取关键信息。请以JSON格式返回，包含以下字段：
- type: 邮件类型 ('meeting', 'todo', 'info', 'other')
- summary: 邮件内容摘要
- action: 建议采取的操作
- details: 详细信息对象，根据邮件类型可能包含：
  - date: 日期 (格式: YYYY-MM-DD，例如: 2024-01-15)
  - time: 时间 (格式: HH:mm，例如: 14:30)
  - duration: 持续时间（分钟）
  - location: 地点
  - attendees: 参与者邮箱数组
  - priority: 优先级 ('high', 'medium', 'low')
  - deadline: 截止时间 (格式: ISO 8601，例如: 2024-01-15T14:30:00.000Z)

重要提示：
- 现在是${new Date().toISOString()}
- 请将任何包含潜在日程的邮件都视为会议邀请或待办事项，无论邮件主题和内容是否明确指出（例如，有些待办事项可能以“通知”开头），都需要提取相关信息。
- 包含潜在日程的活动邀请和广告也算作待办事项，需要提取相关信息。
- 请将报名成功的回执也视为待办事项，需要提取相关信息。
- 包含需要用户进一步操作的邮件（例如，需要用户确认或输入信息，加入群聊），也视为待办事项。
- 请不要漏掉任何日期和时间相关的信息，包括会议开始时间、结束时间、待办事项截止时间等。
- 请根据邮件内容判断是否包含地点信息，若包含则提取并记录。
- 请根据邮件内容判断是否包含截止时间。
- 如果无法确定具体的日期或时间，请不要提供date、time或deadline字段，或者设置为null
- 不要使用"未明确指定"等中文文本作为日期时间值
- 确保所有日期时间格式都是标准的、可解析的格式

请确保返回的是有效的JSON格式，不要包含任何其他文本。`;
    }

    /**
     * 生成确认回复内容
     */
    async generateConfirmationReply(email: IEmail, processResult: EmailProcessResponse): Promise<string> {
        try {
            const prompt = `基于以下邮件内容和分析结果，请生成一封简短的确认回复邮件：

邮件主题: ${email.subject}
邮件内容: ${email.body || ''}
分析结果: ${JSON.stringify(processResult)}

请生成一个专业、简洁的确认回复，表明已收到邮件并简要提及已识别的内容类型。回复应使用中文，语气友好专业。`;

            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个专业的邮件助手，负责生成简洁、专业的邮件回复。'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
            });

            return response.choices[0]?.message?.content || '已收到您的邮件，我们会尽快处理。';
        } catch (error: any) {
            logger.error(`生成确认回复失败: ${error.message || '未知错误'}`);
            return '已收到您的邮件，我们会尽快处理。';
        }
    }

    /**
     * 分析邮件重要性
     */
    async analyzeEmailImportance(email: IEmail): Promise<{ importance: 'high' | 'medium' | 'low'; reason: string }> {
        try {
            const prompt = `请分析以下邮件的重要性，并返回高、中或低的评分以及评分理由：

发件人: ${email.from?.name || email.from?.address || '未知发件人'}
主题: ${email.subject || ''}
内容: ${email.body || ''}

请以JSON格式返回，包含importance字段（'high'、'medium'或'low'）和reason字段（评分理由）。`;

            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个专业的邮件重要性分析助手。'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                response_format: {
                    type: 'json_object'
                },
                temperature: 0.1,
            });

            return JSON.parse(response.choices[0]?.message?.content || '{"importance": "medium", "reason": "无法分析"}');
        } catch (error: any) {
            logger.error(`分析邮件重要性失败: ${error.message || '未知错误'}`);
            return { importance: 'medium', reason: '无法分析重要性' };
        }
    }

    /**
     * 通用聊天接口，支持流式输出
     * @param messages 聊天消息历史
     * @param tools 可选的工具列表
     * @param onData 接收流式数据的回调函数
     */
    async chatStream(messages: any[], tools: any[] | undefined, onData: (data: { content?: string, tool_calls?: any[] }) => void): Promise<void> {
        try {
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